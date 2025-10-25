import getNearShop from "./getNearShop.js";
import { readCSV } from "danfojs-node";
import { mkdirSync } from "fs";
import { Logger } from "../lib/Logger.js";

const date = new Date();
const TODAY = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const logger = new Logger(`./${TODAY}.log`);

async function main() {
  const PATH = `../../../uber_data/shopLst/${TODAY}`;

  // 確保輸出目錄存在
  try {
    mkdirSync(PATH, { recursive: true });
    mkdirSync("./cookies", { recursive: true });
  } catch (e) {
    logger.error(e);
  }

  // read central location information
  const centerStream = await readCSV("../../inputCentral/tw_points.csv", {
    header: true,
  });
  let centerLst = centerStream.loc({
    columns: ["newLat", "newLng"],
  }).values;
  const newAnchors = await readCSV(
    "../../inputCentral/new_anchors_filtered.csv",
    {
      header: true,
    },
  );
  centerLst = centerLst.concat(
    newAnchors.loc({
      columns: ["newLat", "newLng"],
    }).values,
  );

  for (let i = 0; i < centerLst.length; i++) {
    const loc = centerLst[i];
    logger.log(`Processing location ${i + 1} of ${centerLst.length}: [${loc[0]}, ${loc[1]}]`);
    try {
      await getNearShop(TODAY, loc[0], loc[1], date.getDate() == 10, logger);
    } catch (e) {
      logger.error(e);
    }
  }

  logger.log("down shop catch");
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
