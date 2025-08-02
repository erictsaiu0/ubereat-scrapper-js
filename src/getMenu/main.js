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

  // read shopinformation
  const locationPath = `../../../uber_data/shopLst/${TODAY}`;
  let locationLst = readdirSync(locationPath);
  const menuPath = `../../../uber_data/uber_menu/${TODAY}`;

  // init cookie
  let cookie = new Cookie();
  cookie.init();

  for (const location of locationLst) {
    logger.info(location);
    let stores = [];
    let df = await readCSV(`${locationPath}/${location}`);
    df = df.loc({
      columns: ["storeUuid", "name", "anchor_latitude", "anchor_longitude"],
    }).values;
    logger.info(`(${df[0][2]}, ${df[0][3]}): ${df.length} shops`);
    for (const row of df) {
      logger.info(row);
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
      } catch (e) {
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
              ),
            );
            break;
          } catch (er) {
            logger.error(er);
          }
        }
        logger.error(e);
      }
    }
    const result = new DataFrame(stores);
    result.toCSV({
      filePath: `${menuPath}/${location}_${TODAY}.csv`,
      header: true,
    });
  }

  logger.info("down shop catch");
}

const startTime = Date.now();
logger.log("Start executing getShop script at " + new Date().toLocaleString());

main()
  .then(() => {
    const endTime = Date.now();
    const executionTimeSec = (endTime - startTime) / 1000;
    function formatTime(sec) {
      const hrs = Math.floor(sec / 3600);
      const mins = Math.floor((sec % 3600) / 60);
      const secs = Math.floor(sec % 60);
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    logger.log(`Finished executing. Total execution time: ${formatTime(executionTimeSec)}.`);
  })
  .catch((e) => {
    logger.error("Totally failed", e);
  });
