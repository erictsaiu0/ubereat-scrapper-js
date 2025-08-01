import getNearShop from "./getNearShop.js";
import { readCSV } from "danfojs-node";
import { mkdirSync } from "fs";
import { Logger } from "../lib/Logger.js";

const date = new Date();
const TODAY = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const logger = new Logger(`./${TODAY}.log`);
const CSV_NAME = (Bun?.argv ?? process.argv)[2] || "tw_points.csv";

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
  const centerStream = await readCSV(`../../inputCentral/${CSV_NAME}`, {
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

  for (const loc of centerLst) {
    try {
      await getNearShop(TODAY, loc[0], loc[1], date.getDate() == 10, logger);
    } catch (e) {
      logger.error(e);
    }
  }

  logger.log("down shop catch");
}

try {
  main();
} catch (e) {
  logger.error("Totally failed");
}
