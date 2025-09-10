// main.js
import getMenu from "./getMenu.js";
import { Cookie } from "./Cookie.js";
import { mkdirSync, readdirSync, existsSync } from "fs";
import { readCSV } from "danfojs-node";
import { DataFrame } from "danfojs-node";
import { Logger } from "../lib/Logger.js";

const date = new Date();
const TODAY = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const logger = new Logger(`./${TODAY}_menu.log`);

// 路徑設定
const SHOP_ROOT = `../../../uber_data/shopLst/${TODAY}`;
const ROLLING_CSV = `${SHOP_ROOT}/rolling.csv`;
const MENU_DIR = `../../../uber_data/uber_menu/${TODAY}`;
mkdirSync(SHOP_ROOT, { recursive: true });
mkdirSync(MENU_DIR, { recursive: true });

/**
 * Phase 1:
 * 掃描 shopLst/${TODAY} 底下所有 CSV，彙整唯一店家到 rolling.csv
 * - 依 storeUuid 去重（跨所有來源檔）
 * - 保留「首次出現」的資料
 * - 另外加入一欄 `location`（來源檔名），供 Phase 2 分組輸出檔名使用
 */
async function buildRollingCSV() {
  const files = readdirSync(SHOP_ROOT).filter(f => f.toLowerCase().endsWith(".csv"));

  const seen = new Set();
  const out = []; // [storeUuid, name, anchor_latitude, anchor_longitude, location]

  for (const f of files) {
    try {
      const df = await readCSV(`${SHOP_ROOT}/${f}`);
      const cols = ["storeUuid", "name", "anchor_latitude", "anchor_longitude"];
      const values = df.loc({ columns: cols }).values;

      for (const row of values) {
        const [uuid, name, lat, lng] = row;
        if (!uuid) continue;
        if (seen.has(uuid)) continue; // 去重：跨所有來源檔
        seen.add(uuid);
        out.push([uuid, name, lat, lng, f]); // 增加來源檔名欄位 location=f
      }
      logger.info(`Scanned ${f}: ${values.length} rows → ${out.length} unique so far.`);
    } catch (e) {
      logger.error(`Failed to read or parse ${f}: ${e}`);
    }
  }

  const dfOut = new DataFrame(out, {
    columns: ["storeUuid", "name", "anchor_latitude", "anchor_longitude", "location"],
  });
  await dfOut.toCSV({ filePath: ROLLING_CSV, header: true });
  logger.info(`Wrote rolling.csv with ${out.length} unique stores at ${ROLLING_CSV}`);
}

/**
 * Phase 2:
 * 依 rolling.csv 的 `location` 欄位分組，逐組爬 menu，並維持原本的輸出命名：
 *   uber_data/uber_menu/${TODAY}/${location}_${TODAY}.csv
 *
 * 注意：
 * - 這裡不再做跨檔去重，因為 rolling.csv 已經完成去重
 * - 每個 location 會產生一個對應輸出檔
 */
async function crawlFromRolling() {
  // init cookie（沿用既有流程）
  const cookie = new Cookie();
  cookie.init();

  // 讀 rolling.csv
  const df = await readCSV(ROLLING_CSV);
  const rows = df.loc({
    columns: ["storeUuid", "name", "anchor_latitude", "anchor_longitude", "location"],
  }).values;

  // 依 location 分組
  const groups = new Map();
  for (const row of rows) {
    const [uuid, name, lat, lng, location] = row;
    if (!uuid) continue;
    if (!groups.has(location)) groups.set(location, []);
    groups.get(location).push([uuid, name, lat, lng]);
  }

  logger.info(`Start crawling ${rows.length} shops from rolling.csv across ${groups.size} locations`);

  // 逐 location 處理並輸出
  for (const [location, list] of groups.entries()) {
    const stores = [];
    logger.info(`Processing group: ${location} (${list.length} shops)`);

    for (const [uuid, name, lat, lng] of list) {
      try {
        const data = await getMenu(cookie, uuid, name, lat, lng, true, logger);
        stores.push(data);
      } catch (e) {
        // 最多三次重試
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          try {
            const data = await getMenu(cookie, uuid, name, lat, lng, true, logger);
            stores.push(data);
            ok = true;
          } catch (er) {
            logger.error(`Retry ${i + 1} for ${uuid} failed: ${er}`);
          }
        }
        if (!ok) logger.error(`Failed after retries for store ${uuid} (${name})`);
      }
      console.log(`  Completed ${stores.length}/${list.length} for ${location}`); // 進度回報
    }
    console.log(`Completed group: ${location}, total successful: ${stores.length}`);

    // 維持原本的命名規則：${location}_${TODAY}.csv
    try {
      const result = new DataFrame(stores);
      const outFile = `${MENU_DIR}/${location}_${TODAY}.csv`;
      await result.toCSV({ filePath: outFile, header: true });
      logger.info(`Wrote ${stores.length} rows to ${outFile}`);
    } catch (e) {
      logger.error(`Failed to write CSV for ${location}: ${e}`);
    }
  }

  logger.info("done shop menu crawl (from rolling.csv)");
}

async function main() {
  // 若尚無 rolling.csv，先建；若已存在就直接用（避免重掃）
  if (!existsSync(ROLLING_CSV)) {
    await buildRollingCSV();
  } else {
    logger.info(`Found existing ${ROLLING_CSV}, skip rebuild.`);
  }
  await crawlFromRolling();
}

// 執行與計時
const startTime = Date.now();
logger.log("Start executing getMenu script at " + new Date().toLocaleString());
main()
  .then(() => {
    const endTime = Date.now();
    const sec = Math.floor((endTime - startTime) / 1000);
    const h = String(Math.floor(sec / 3600)).padStart(2, "0");
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
    const s = String(sec % 60).padStart(2, "0");
    logger.log(`Finished. Total execution time: ${h}:${m}:${s}.`);
  })
  .catch((e) => logger.error("Totally failed", e));
