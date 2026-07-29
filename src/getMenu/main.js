// main.js
import getMenu, { initializeMenuSession } from "./getMenu.js";
import { Cookie } from "./Cookie.js";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { readCSV, DataFrame } from "danfojs-node";
import { Logger } from "../lib/Logger.js";

const SHOP_ROOT = "../../../uber_data/shopLst";
const MENU_ROOT = "../../../uber_data/uber_menu";
const ROLLING_CSV = `${SHOP_ROOT}/rolling.csv`;
const ROLLING_META = `${SHOP_ROOT}/rolling.meta.json`;
const ROLLING_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

mkdirSync(SHOP_ROOT, { recursive: true });
mkdirSync(MENU_ROOT, { recursive: true });

function findLatestCheckpoint() {
  const candidates = [];

  for (const entry of readdirSync(MENU_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const filePath = `${MENU_ROOT}/${entry.name}/checkpoint.json`;

    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const checkpoint = JSON.parse(readFileSync(filePath, "utf8"));

      if (!checkpoint.runDate || !checkpoint.location) {
        continue;
      }

      candidates.push({
        checkpoint,
        updatedAt: Date.parse(checkpoint.updatedAt) || 0,
      });
    } catch {
      // loadCheckpoint() will report a detailed error for the selected run.
    }
  }

  candidates.sort((a, b) => b.updatedAt - a.updatedAt);
  return candidates[0]?.checkpoint ?? null;
}

const date = new Date();
const DEFAULT_DATE = `${date.getFullYear()}-${String(
  date.getMonth() + 1,
).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const DISCOVERED_CHECKPOINT = process.env.RUN_DATE
  ? null
  : findLatestCheckpoint();
const TODAY = process.env.RUN_DATE ??
  DISCOVERED_CHECKPOINT?.runDate ??
  DEFAULT_DATE;

const logger = new Logger(`./${TODAY}_menu.log`);

const SHOP_TODAY_DIR = `${SHOP_ROOT}/${TODAY}`;
const MENU_DIR = `${MENU_ROOT}/${TODAY}`;
const CHECKPOINT_FILE = `${MENU_DIR}/checkpoint.json`;
const NTFY_SERVER = process.env.NTFY_SERVER ?? "https://ntfy.sh";
const NTFY_TOPIC = process.env.NTFY_TOPIC ?? "ue-menu-75873";
const NTFY_TOKEN = process.env.NTFY_TOKEN;

const GROUP_DELAY_MIN_MS = 4000;
const GROUP_DELAY_MAX_MS = 8000;
const SHORT_BREAK_MIN_MS = 15 * 1000;
const SHORT_BREAK_MAX_MS = 25 * 1000;
const SHORT_BREAK_STORE_MIN = 10;
const SHORT_BREAK_STORE_MAX = 15;
const LONG_BREAK_MIN_MS = 75 * 1000;
const LONG_BREAK_MAX_MS = 150 * 1000;
const LONG_BREAK_STORE_MIN = 800;
const LONG_BREAK_STORE_MAX = 1200;
const CHECKPOINT_INTERVAL = 100;
const BOT_CHALLENGE_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_BOT_CHALLENGES = 3;

mkdirSync(SHOP_TODAY_DIR, { recursive: true });
mkdirSync(MENU_DIR, { recursive: true });

if (DISCOVERED_CHECKPOINT) {
  logger.info(
    `Auto-resume locked run date to ${TODAY} from checkpoint ` +
      `${DISCOVERED_CHECKPOINT.location}`,
  );
}

let stopRequested = false;

process.on("SIGINT", () => {
  if (stopRequested) {
    process.exit(130);
  }

  stopRequested = true;
  logger.info(
    "SIGINT received; finishing the current request before saving checkpoint.",
  );
});

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function describeValue(value) {
  if (value === null) {
    return "null";
  }

  if (value === undefined) {
    return "undefined";
  }

  if (Array.isArray(value)) {
    return `array(length=${value.length})`;
  }

  return typeof value;
}

function formatError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepUntilStopRequested(ms) {
  const deadline = Date.now() + ms;

  while (!stopRequested && Date.now() < deadline) {
    await sleep(Math.min(1000, deadline - Date.now()));
  }
}

function randomInteger(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function isBotChallenge(error) {
  return error?.code === "UBER_BOT_CHALLENGE";
}

async function sendNotification(title, message, priority = "default") {
  if (!NTFY_TOPIC) {
    logger.error("Skipped ntfy notification: NTFY_TOPIC is empty");
    return false;
  }

  const headers = {
    Title: title,
    Priority: priority,
    Tags: priority === "urgent" ? "warning" : "white_check_mark",
  };

  if (NTFY_TOKEN) {
    headers.Authorization = `Bearer ${NTFY_TOKEN}`;
  }

  try {
    const server = NTFY_SERVER.replace(/\/+$/, "");
    const response = await fetch(
      `${server}/${encodeURIComponent(NTFY_TOPIC)}`,
      {
        method: "POST",
        headers,
        body: message,
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      throw new Error(`ntfy returned HTTP ${response.status}`);
    }

    logger.info(`Sent ntfy notification: ${title}`);
    return true;
  } catch (error) {
    logger.error(`Failed to send ntfy notification: ${formatError(error)}`);
    return false;
  }
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_FILE)) {
    return null;
  }

  try {
    const checkpoint = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));
    logger.info(
      `Loaded checkpoint for ${checkpoint.location}: ` +
        `${checkpoint.completedUuids?.length ?? 0} stores completed`,
    );
    return checkpoint;
  } catch (error) {
    logger.error(`Failed to load checkpoint: ${formatError(error)}`);
    return null;
  }
}

function saveCheckpoint(location, completedUuids, stores) {
  writeFileSync(
    CHECKPOINT_FILE,
    JSON.stringify({
      version: 1,
      runDate: TODAY,
      location,
      updatedAt: new Date().toISOString(),
      completedUuids: [...completedUuids],
      stores,
    }),
  );

  logger.info(
    `Saved checkpoint for ${location}: ` +
      `${completedUuids.size} stores completed, ${stores.length} rows`,
  );
}

function clearCheckpoint(location) {
  if (!existsSync(CHECKPOINT_FILE)) {
    return;
  }

  try {
    const checkpoint = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8"));

    if (checkpoint.location === location) {
      unlinkSync(CHECKPOINT_FILE);
      logger.info(`Cleared checkpoint after completing ${location}`);
    }
  } catch (error) {
    logger.error(`Failed to clear checkpoint: ${formatError(error)}`);
  }
}

async function stopAfterCheckpoint(
  location,
  completedUuids,
  stores,
  completedStores,
  totalStores,
) {
  saveCheckpoint(location, completedUuids, stores);

  const error = new Error(
    "Menu crawl stopped by SIGINT after saving checkpoint",
  );
  error.code = "USER_REQUESTED_STOP";
  error.notificationSent = await sendNotification(
    "Uber Eats menu crawler paused",
    [
      `Run date: ${TODAY}`,
      `Location: ${location}`,
      `Completed in this group: ${completedStores}/${totalStores}`,
      `Checkpoint: ${CHECKPOINT_FILE}`,
      `Paused at: ${new Date().toLocaleString()}`,
    ].join("\n"),
    "high",
  );
  throw error;
}

function getRollingCreatedAt() {
  if (!existsSync(ROLLING_CSV)) {
    return null;
  }

  if (existsSync(ROLLING_META)) {
    try {
      const metadata = JSON.parse(readFileSync(ROLLING_META, "utf8"));
      const generatedAt = Date.parse(metadata.generatedAt);

      if (Number.isFinite(generatedAt)) {
        return generatedAt;
      }
    } catch (error) {
      logger.error(`Failed to read rolling metadata: ${formatError(error)}`);
    }
  }

  return statSync(ROLLING_CSV).mtimeMs;
}

/**
 * IMPORTANT: rolling.csv consistency policy
 *
 * 1. An unfinished menu checkpoint always owns the current rolling.csv.
 *    Never rebuild rolling.csv while that checkpoint exists, even if the
 *    crawl resumes days later. Rebuilding would change ordering/location
 *    data underneath the checkpoint and make cross-day resume unreliable.
 * 2. Without an unfinished checkpoint, rolling.csv is reused for up to
 *    10 days. It is rebuilt from shopLst/${TODAY} only when missing or old.
 *
 * Keep this rule intact when modifying getShop/getMenu orchestration.
 */
async function prepareRollingCSV(checkpoint) {
  if (checkpoint) {
    if (!existsSync(ROLLING_CSV)) {
      throw new Error(
        `Cannot resume ${checkpoint.runDate}: ${ROLLING_CSV} is missing`,
      );
    }

    logger.info(
      `Preserved rolling.csv for unfinished checkpoint ${checkpoint.runDate}; ` +
        "age limit intentionally ignored until this menu batch completes.",
    );
    return;
  }

  const createdAt = getRollingCreatedAt();

  if (createdAt !== null) {
    const ageMs = Date.now() - createdAt;

    if (ageMs < ROLLING_MAX_AGE_MS) {
      logger.info(
        `Reusing rolling.csv; age=${(ageMs / 86400000).toFixed(2)} days, ` +
          "refresh threshold=10 days.",
      );
      return;
    }

    logger.info(
      `rolling.csv is ${(ageMs / 86400000).toFixed(2)} days old; rebuilding.`,
    );
  }

  await buildRollingCSV();
}

/**
 * 將 getMenu() 回傳值統一轉為「物件陣列」。
 *
 * 支援：
 * - 單一物件
 * - 物件陣列
 *
 * 拒絕：
 * - null
 * - undefined
 * - 字串、數字等非物件資料
 * - 不包含任何有效物件的陣列
 */
function normalizeMenuRows(data, context) {
  if (data === null || data === undefined) {
    throw new TypeError(
      `getMenu returned ${describeValue(data)} for ${context}`,
    );
  }

  if (Array.isArray(data)) {
    const validRows = data.filter(isPlainObject);
    const invalidCount = data.length - validRows.length;

    if (invalidCount > 0) {
      logger.error(
        `Filtered ${invalidCount} invalid menu rows for ${context}`,
      );
    }

    if (validRows.length === 0) {
      throw new TypeError(
        `getMenu returned an array without valid object rows for ${context}`,
      );
    }

    return validRows;
  }

  if (isPlainObject(data)) {
    return [data];
  }

  throw new TypeError(
    `getMenu returned unsupported data for ${context}: ${describeValue(data)}`,
  );
}

/**
 * Phase 1：
 * 掃描 shopLst/${TODAY} 底下所有 CSV，
 * 依 storeUuid 去重後建立 rolling.csv。
 */
async function buildRollingCSV() {
  const files = readdirSync(SHOP_TODAY_DIR).filter((fileName) =>
    fileName.toLowerCase().endsWith(".csv"),
  );

  if (files.length === 0) {
    throw new Error(
      `No CSV files found in ${SHOP_TODAY_DIR}`,
    );
  }

  const seen = new Set();
  const out = [];

  for (const fileName of files) {
    const filePath = `${SHOP_TODAY_DIR}/${fileName}`;

    try {
      const df = await readCSV(filePath);

      const requiredColumns = [
        "storeUuid",
        "name",
        "anchor_latitude",
        "anchor_longitude",
      ];

      const missingColumns = requiredColumns.filter(
        (column) => !df.columns.includes(column),
      );

      if (missingColumns.length > 0) {
        throw new Error(
          `Missing required columns: ${missingColumns.join(", ")}`,
        );
      }

      const values = df.loc({
        columns: requiredColumns,
      }).values;

      for (const row of values) {
        if (!Array.isArray(row)) {
          logger.error(
            `Skipped invalid row in ${fileName}: ${JSON.stringify(row)}`,
          );
          continue;
        }

        const [uuid, name, latitude, longitude] = row;

        if (!uuid) {
          continue;
        }

        if (seen.has(uuid)) {
          continue;
        }

        seen.add(uuid);

        out.push([
          uuid,
          name,
          latitude,
          longitude,
          fileName,
        ]);
      }

      logger.info(
        `Scanned ${fileName}: ${values.length} rows → ${out.length} unique so far.`,
      );
    } catch (error) {
      logger.error(
        `Failed to read or parse ${fileName}: ${formatError(error)}`,
      );
    }
  }

  if (out.length === 0) {
    throw new Error(
      `No valid stores were collected from ${SHOP_TODAY_DIR}`,
    );
  }

  const dfOut = new DataFrame(out, {
    columns: [
      "storeUuid",
      "name",
      "anchor_latitude",
      "anchor_longitude",
      "location",
    ],
  });

  await dfOut.toCSV({
    filePath: ROLLING_CSV,
    header: true,
  });

  writeFileSync(
    ROLLING_META,
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceDate: TODAY,
      storeCount: out.length,
    }, null, 2),
  );

  logger.info(
    `Wrote rolling.csv with ${out.length} unique stores at ${ROLLING_CSV}`,
  );
}

/**
 * 抓取單一店家，失敗時重試。
 *
 * maxRetries = 2 代表：
 * - 初次執行 1 次
 * - 額外重試 2 次
 * - 最多總共 3 次
 */
async function fetchStoreWithRetries(
  cookie,
  uuid,
  name,
  latitude,
  longitude,
  maxRetries = 2,
) {
  const context =
    `${name ?? "unknown-shop"} (${uuid}) ` +
    `@ ${latitude},${longitude}`;

  let lastError;

  for (
    let attempt = 1;
    attempt <= maxRetries + 1;
    attempt += 1
  ) {
    try {
      const data = await getMenu(
        cookie,
        uuid,
        name,
        latitude,
        longitude,
        true,
        logger,
      );

      return normalizeMenuRows(data, context);
    } catch (error) {
      lastError = error;

      if (isBotChallenge(error)) {
        throw error;
      }

      if (attempt <= maxRetries) {
        logger.error(
          `Attempt ${attempt} failed for ${context}: ${formatError(error)}`,
        );
      }
    }
  }

  throw lastError ?? new Error(
    `Unknown failure while crawling ${context}`,
  );
}

/**
 * Phase 2：
 * 讀取 rolling.csv，依 location 分組，
 * 每一組分別抓取菜單並輸出 CSV。
 */
async function crawlFromRolling(checkpoint) {
  let cookie = new Cookie();
  cookie.init();

  const df = await readCSV(ROLLING_CSV);

  const requiredColumns = [
    "storeUuid",
    "name",
    "anchor_latitude",
    "anchor_longitude",
    "location",
  ];

  const missingColumns = requiredColumns.filter(
    (column) => !df.columns.includes(column),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `rolling.csv is missing columns: ${missingColumns.join(", ")}`,
    );
  }

  const rows = df.loc({
    columns: requiredColumns,
  }).values;

  const groups = new Map();

  for (const row of rows) {
    if (!Array.isArray(row)) {
      logger.error(
        `Skipped invalid rolling.csv row: ${JSON.stringify(row)}`,
      );
      continue;
    }

    const [
      uuid,
      name,
      latitude,
      longitude,
      location,
    ] = row;

    if (!uuid || !location) {
      logger.error(
        `Skipped rolling.csv row with missing uuid or location: ${JSON.stringify(
          row,
        )}`,
      );
      continue;
    }

    if (!groups.has(location)) {
      groups.set(location, []);
    }

    groups.get(location).push([
      uuid,
      name,
      latitude,
      longitude,
    ]);
  }

  logger.info(
    `Start crawling ${rows.length} shops from rolling.csv across ${groups.size} locations`,
  );

  if (checkpoint && !groups.has(checkpoint.location)) {
    throw new Error(
      `Checkpoint location is missing from rolling.csv: ${checkpoint.location}`,
    );
  }

  let processedSinceShortBreak = 0;
  let nextShortBreakAt = randomInteger(
    SHORT_BREAK_STORE_MIN,
    SHORT_BREAK_STORE_MAX,
  );
  let processedSinceLongBreak = 0;
  let nextLongBreakAt = randomInteger(
    LONG_BREAK_STORE_MIN,
    LONG_BREAK_STORE_MAX,
  );
  let groupIndex = 0;
  let checkpointReached = checkpoint === null;
  let consecutiveBotChallenges = 0;

  for (const [location, list] of groups.entries()) {
    const outFile = `${MENU_DIR}/${location}_${TODAY}.csv`;

    if (checkpoint && !checkpointReached) {
      if (location === checkpoint.location) {
        checkpointReached = true;
      } else {
        logger.info(`Skipped group completed before checkpoint: ${location}`);
        groupIndex += 1;
        continue;
      }
    }

    if (existsSync(outFile)) {
      logger.info(`Skipped completed group: ${location}`);
      clearCheckpoint(location);
      groupIndex += 1;
      continue;
    }

    if (groupIndex > 0) {
      const delayMs = randomInteger(
        GROUP_DELAY_MIN_MS,
        GROUP_DELAY_MAX_MS,
      );
      logger.info(`Group cooldown: ${Math.ceil(delayMs / 1000)} seconds`);
      await sleep(delayMs);
    }

    const resumedCheckpoint = checkpoint?.location === location
      ? checkpoint
      : null;
    const stores = Array.isArray(resumedCheckpoint?.stores)
      ? resumedCheckpoint.stores.filter(isPlainObject)
      : [];
    const completedUuids = new Set(
      resumedCheckpoint?.completedUuids ?? [],
    );

    let completedStores = completedUuids.size;
    let successfulStores = stores.length;
    let failedStores = 0;

    logger.info(
      `Processing group: ${location} (${list.length} shops)`,
    );

    // Create the cross-day resume marker before the first request in a group.
    saveCheckpoint(location, completedUuids, stores);

    if (stopRequested) {
      await stopAfterCheckpoint(
        location,
        completedUuids,
        stores,
        completedStores,
        list.length,
      );
    }

    await initializeMenuSession(cookie);

    for (const [
      uuid,
      name,
      latitude,
      longitude,
    ] of list) {
      if (completedUuids.has(uuid)) {
        continue;
      }

      if (stopRequested) {
        await stopAfterCheckpoint(
          location,
          completedUuids,
          stores,
          completedStores,
          list.length,
        );
      }

      while (true) {
        try {
          const menuRows = await fetchStoreWithRetries(
            cookie,
            uuid,
            name,
            latitude,
            longitude,
          );

          /*
           * getMenu / extractData 可能回傳多筆資料。
           * 使用展開運算子避免 stores 變成巢狀陣列。
           */
          stores.push(...menuRows);
          successfulStores += 1;

          if (consecutiveBotChallenges > 0) {
            logger.info(
              `Recovered from bot challenge after ` +
                `${consecutiveBotChallenges} cooldown attempt(s).`,
            );
            consecutiveBotChallenges = 0;
          }

          break;
        } catch (error) {
          if (!isBotChallenge(error)) {
            failedStores += 1;
            consecutiveBotChallenges = 0;

            logger.error(
              `Failed after retries for store ${uuid} (${name}) ` +
                `@ ${latitude},${longitude}: ${formatError(error)}`,
            );
            break;
          }

          consecutiveBotChallenges += 1;
          saveCheckpoint(location, completedUuids, stores);

          if (
            consecutiveBotChallenges >= MAX_CONSECUTIVE_BOT_CHALLENGES
          ) {
            logger.error(
              `Bot challenge ${consecutiveBotChallenges}/` +
                `${MAX_CONSECUTIVE_BOT_CHALLENGES} at ${location}, ` +
                `store ${uuid}. Stopping after repeated cooldown failures.`,
            );

            error.notificationSent = await sendNotification(
              "Uber Eats menu crawler stopped",
              [
                "Reason: repeated RECAPTCHA bot challenges",
                `Consecutive challenges: ${consecutiveBotChallenges}/` +
                  `${MAX_CONSECUTIVE_BOT_CHALLENGES}`,
                `Run date: ${TODAY}`,
                `Location: ${location}`,
                `Completed in this group: ${completedStores}/${list.length}`,
                `Successful rows: ${stores.length}`,
                `Checkpoint: ${CHECKPOINT_FILE}`,
                `Stopped at: ${new Date().toLocaleString()}`,
              ].join("\n"),
              "urgent",
            );

            throw error;
          }

          logger.error(
            `Bot challenge ${consecutiveBotChallenges}/` +
              `${MAX_CONSECUTIVE_BOT_CHALLENGES} at ${location}, ` +
              `store ${uuid}. Saved checkpoint; cooling down for ` +
              `${BOT_CHALLENGE_COOLDOWN_MS / 60000} minutes before retry.`,
          );

          await sleepUntilStopRequested(BOT_CHALLENGE_COOLDOWN_MS);

          if (stopRequested) {
            await stopAfterCheckpoint(
              location,
              completedUuids,
              stores,
              completedStores,
              list.length,
            );
          }

          cookie = new Cookie();
          cookie.init();
          await initializeMenuSession(cookie);

          logger.info(
            `Bot challenge cooldown completed; retrying store ${uuid} ` +
              `with a new session.`,
          );
        }
      }

      if (!completedUuids.has(uuid)) {
        completedUuids.add(uuid);
        completedStores += 1;
        processedSinceShortBreak += 1;
        processedSinceLongBreak += 1;
      }

      console.log(
        `Completed ${completedStores}/${list.length} stores ` +
          `for ${location}; ` +
          `successful=${successfulStores}; ` +
          `failed=${failedStores}; ` +
          `rows=${stores.length}`,
      );

      if (completedStores % CHECKPOINT_INTERVAL === 0) {
        saveCheckpoint(location, completedUuids, stores);
      }

      if (stopRequested) {
        await stopAfterCheckpoint(
          location,
          completedUuids,
          stores,
          completedStores,
          list.length,
        );
      }

      if (processedSinceShortBreak >= nextShortBreakAt) {
        const delayMs = randomInteger(
          SHORT_BREAK_MIN_MS,
          SHORT_BREAK_MAX_MS,
        );
        logger.info(
          `Short cooldown after ${processedSinceShortBreak} stores: ` +
            `${Math.ceil(delayMs / 1000)} seconds`,
        );
        await sleep(delayMs);

        processedSinceShortBreak = 0;
        nextShortBreakAt = randomInteger(
          SHORT_BREAK_STORE_MIN,
          SHORT_BREAK_STORE_MAX,
        );
      }

      if (processedSinceLongBreak >= nextLongBreakAt) {
        saveCheckpoint(location, completedUuids, stores);

        const delayMs = randomInteger(
          LONG_BREAK_MIN_MS,
          LONG_BREAK_MAX_MS,
        );
        logger.info(
          `Long cooldown after ${processedSinceLongBreak} stores: ` +
            `${Math.ceil(delayMs / 60000)} minutes`,
        );
        await sleep(delayMs);

        processedSinceLongBreak = 0;
        nextLongBreakAt = randomInteger(
          LONG_BREAK_STORE_MIN,
          LONG_BREAK_STORE_MAX,
        );
      }
    }

    /*
     * 寫入前再檢查一次，避免 null、undefined、
     * 巢狀陣列或其他異常資料進入 Danfo。
     */
    const validRows = stores.filter(isPlainObject);
    const invalidRows = stores.length - validRows.length;

    if (invalidRows > 0) {
      logger.error(
        `Removed ${invalidRows} invalid rows before CSV export for ${location}`,
      );
    }

    if (validRows.length === 0) {
      logger.error(
        `Skipped CSV export for ${location}: ` +
          `no valid rows collected; ` +
          `successful stores=${successfulStores}; ` +
          `failed stores=${failedStores}`,
      );

      clearCheckpoint(location);
      groupIndex += 1;
      continue;
    }

    try {
      const result = new DataFrame(validRows);

      await result.toCSV({
        filePath: outFile,
        header: true,
      });

      logger.info(
        `Wrote ${validRows.length} rows ` +
          `from ${successfulStores} stores ` +
          `to ${outFile}; ` +
          `failed stores: ${failedStores}`,
      );

      clearCheckpoint(location);
    } catch (error) {
      saveCheckpoint(location, completedUuids, validRows);

      /*
       * 顯示前五筆資料的欄位名稱，
       * 方便檢查是否有不同結構或巢狀欄位。
       */
      const sampleKeys = validRows
        .slice(0, 5)
        .map((row) => Object.keys(row).join(","))
        .join(" | ");

      logger.error(
        `Failed to write CSV for ${location}: ` +
          `${formatError(error)}; ` +
          `rows=${validRows.length}; ` +
          `sampleKeys=${sampleKeys}`,
      );
    }

    groupIndex += 1;
  }

  logger.info(
    "done shop menu crawl (from rolling.csv)",
  );
}

async function main() {
  const checkpoint = loadCheckpoint();
  await prepareRollingCSV(checkpoint);
  await crawlFromRolling(checkpoint);
}

const startTime = Date.now();

logger.info(
  `Start executing getMenu script at ${new Date().toLocaleString()}`,
);

main()
  .then(async () => {
    const endTime = Date.now();
    const seconds = Math.floor(
      (endTime - startTime) / 1000,
    );

    const hours = String(
      Math.floor(seconds / 3600),
    ).padStart(2, "0");

    const minutes = String(
      Math.floor((seconds % 3600) / 60),
    ).padStart(2, "0");

    const remainingSeconds = String(
      seconds % 60,
    ).padStart(2, "0");

    logger.info(
      `Finished. Total time: ` +
        `${hours}:${minutes}:${remainingSeconds}`,
    );

    await sendNotification(
      "Uber Eats menu crawler completed",
      [
        `Run date: ${TODAY}`,
        `Total time: ${hours}:${minutes}:${remainingSeconds}`,
        `Output: ${MENU_DIR}`,
        `Completed at: ${new Date().toLocaleString()}`,
      ].join("\n"),
      "high",
    );
  })
  .catch(async (error) => {
    logger.error(
      `Fatal error: ${formatError(error)}`,
    );

    if (!error?.notificationSent) {
      await sendNotification(
        "Uber Eats menu crawler failed",
        [
          `Run date: ${TODAY}`,
          `Error: ${error?.message ?? String(error)}`,
          `Checkpoint: ${CHECKPOINT_FILE}`,
          `Failed at: ${new Date().toLocaleString()}`,
        ].join("\n"),
        "urgent",
      );
    }

    process.exitCode = 1;
  });
