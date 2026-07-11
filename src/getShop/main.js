import getNearShop from "./getNearShop.js";
import { readCSV } from "danfojs-node";
import { mkdirSync } from "fs";
import { Logger } from "../lib/Logger.js";

const date = new Date();
const TODAY = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const logger = new Logger(`./${TODAY}.log`);
const DEBUG_RESPONSE =
  process.env.DEBUG_RESPONSE === "1" ||
  process.argv.includes("--debug-response");

function formatTime(sec) {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function buildProgressMessage(i, total, loc) {
  const completed = i;
  const remaining = total - completed;
  const elapsedSec = (Date.now() - startTime) / 1000;
  const avgSec = completed > 0 ? elapsedSec / completed : null;
  const etaSec = avgSec == null ? null : avgSec * remaining;
  const etaText = etaSec == null ? "calculating" : formatTime(etaSec);
  const finishText =
    etaSec == null
      ? "calculating"
      : new Date(Date.now() + etaSec * 1000).toLocaleString();

  return (
    `Processing location ${i + 1} of ${total}: [${loc[0]}, ${loc[1]}] ` +
    `(remaining=${remaining}, elapsed=${formatTime(elapsedSec)}, ` +
    `eta=${etaText}, estimatedFinish=${finishText})`
  );
}

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
    logger.log(buildProgressMessage(i, centerLst.length, loc));
    try {
      await getNearShop(
        TODAY,
        loc[0],
        loc[1],
        date.getDate() == 10,
        logger,
        DEBUG_RESPONSE,
      );
    } catch (e) {
      logger.error(e);
    }
  }

  logger.log("down shop catch");
}

const startTime = Date.now();
logger.log("Start executing getShop script at " + new Date().toLocaleString());
logger.log(`Output date folder locked to ${TODAY} for this run.`);

main()
  .then(() => {
    const endTime = Date.now();
    const executionTimeSec = (endTime - startTime) / 1000;
    logger.log(`Finished executing. Total execution time: ${formatTime(executionTimeSec)}.`);
  })
  .catch((e) => {
    logger.error("Totally failed", e);
  });
