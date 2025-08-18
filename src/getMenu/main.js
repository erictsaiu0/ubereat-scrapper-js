import getMenu from "./getMenu.js";
import { Cookie } from "./Cookie.js";
import { mkdirSync, readdirSync } from "fs";
import { readCSV } from "danfojs-node";
import { DataFrame } from "danfojs-node";
import { Logger } from "../lib/Logger.js";

const date = new Date();
const TODAY = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const logger = new Logger(`./${TODAY}_menu.log`);

async function main() {
  const PATH = `../../../uber_data/uber_menu/${TODAY}`;

  // 確保輸出目錄存在
  try {
    mkdirSync(PATH, { recursive: true });
  } catch (e) {}

  // 來源店家列表（多個地區 CSV）
  const locationPath = `../../../uber_data/shopLst/${TODAY}`;
  let locationLst = readdirSync(locationPath)
    .filter((f) => f.toLowerCase().endsWith(".csv")); // 排除非 CSV 檔

  const menuPath = `../../../uber_data/uber_menu/${TODAY}`;

  // init cookie
  let cookie = new Cookie();
  cookie.init();

  // 全域去重：跨所有地區檔案，共用一個 Set，避免重複爬同一家店
  const seenStoreUuids = new Set();

  for (const location of locationLst) {
    logger.info(`Processing file: ${location}`);

    // 讀取店家資料
    let df;
    try {
      df = await readCSV(`${locationPath}/${location}`);
    } catch (e) {
      logger.error(`Failed to read ${location}: ${e}`);
      continue;
    }

    // 只取需要的欄位
    let rows = [];
    try {
      rows = df
        .loc({
          columns: ["storeUuid", "name", "anchor_latitude", "anchor_longitude"],
        })
        .values;
    } catch (e) {
      logger.error(`Columns missing in ${location}: ${e}`);
      continue;
    }

    const before = rows.length;

    // 依 storeUuid 去重（跨檔案）
    const uniqueRows = [];
    for (const row of rows) {
      const [storeUuid] = row;
      if (!storeUuid) continue;
      if (seenStoreUuids.has(storeUuid)) continue;
      seenStoreUuids.add(storeUuid);
      uniqueRows.push(row);
    }

    const after = uniqueRows.length;
    if (after === 0) {
      logger.info(`Skip ${location}: all ${before} shops already processed by previous files.`);
      // 仍然產生一個空的輸出檔，或直接 continue。視你的需求：
      // continue;
    } else {
      const lat = uniqueRows[0][2];
      const lng = uniqueRows[0][3];
      logger.info(`(${lat}, ${lng}): ${after} unique shops (filtered from ${before})`);
    }

    // 逐店爬取
    const stores = [];
    for (const row of uniqueRows) {
      logger.info(row);
      try {
        stores.push(
          await getMenu(
            cookie,
            row[0], // storeUuid
            row[1], // name
            row[2], // anchor_latitude
            row[3], // anchor_longitude
            date.getDate() >= 10 && date.getDate() < 17,
            logger,
          ),
        );
      } catch (e) {
        // 失敗則最多重試三次（補上 logger 參數）
        let cnt = 0;
        while (cnt < 3) {
          cnt += 1;
          try {
            stores.push(
              await getMenu(
                cookie,
                row[0],
                row[1],
                row[2],
                row[3],
                date.getDate() >= 10 && date.getDate() < 17,
                logger,
              ),
            );
            break;
          } catch (er) {
            logger.error(er);
          }
        }
        if (cnt >= 3) {
          logger.error(`Failed after retries for store ${row[0]} (${row[1]})`);
        }
      }
    }

    // 輸出本檔案對應的結果（僅包含「去重後」實際爬到的店）
    try {
      const result = new DataFrame(stores);
      await result.toCSV({
        filePath: `${menuPath}/${location}_${TODAY}.csv`,
        header: true,
      });
      logger.info(`Wrote ${stores.length} rows to ${menuPath}/${location}_${TODAY}.csv`);
    } catch (e) {
      logger.error(`Failed to write CSV for ${location}: ${e}`);
    }
  }

  logger.info("done shop menu crawl");
}

const startTime = Date.now();
logger.log("Start executing getMenu script at " + new Date().toLocaleString());

main()
  .then(() => {
    const endTime = Date.now();
    const executionTimeSec = (endTime - startTime) / 1000;
    function formatTime(sec) {
      const hrs = Math.floor(sec / 3600);
      const mins = Math.floor((sec % 3600) / 60);
      const secs = Math.floor(sec % 60);
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    logger.log(`Finished executing. Total execution time: ${formatTime(executionTimeSec)}.`);
  })
  .catch((e) => {
    logger.error("Totally failed", e);
  });
