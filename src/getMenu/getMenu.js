import sendReqMenu from "./sendReqMenu.js";
import { Cookie } from "./Cookie.js";
import { mkdirSync, writeFileSync } from "fs";
import extractData from "./extractData.js";
import { Logger } from "../lib/Logger.js";

const FEED_DELAY_MIN_MS = 1500;
const FEED_DELAY_MAX_MS = 2500;
const MENU_DELAY_MIN_MS = 2000;
const MENU_DELAY_MAX_MS = 3500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 *
 * @param {Cookie} cookie
 * @param {string} shopUuid
 * @param {string} shopName
 * @param {number} latitude
 * @param {number} longitude
 * @param {boolean} storeJson
 * @param {Logger} logger
 */
export default async function getMenu(
  cookie,
  shopUuid,
  shopName,
  latitude,
  longitude,
  storeJson,
  logger,
) {
  await sleep(randomDelay(FEED_DELAY_MIN_MS, FEED_DELAY_MAX_MS));
  let get = await fetch(
    "https://www.ubereats.com/tw/feed?diningMode=DELIVERY",
    // { verbose: true },
  );
  cookie.updateCookies(get.headers.getSetCookie().join("; "));
  cookie.setCookie("mcd_restaurant", "");

  let now = new Date();

  // fetch logic
  await sleep(randomDelay(MENU_DELAY_MIN_MS, MENU_DELAY_MAX_MS));
  try {
    let response = await sendReqMenu(
      cookie,
      shopUuid,
      latitude,
      longitude,
      logger,
    );
    const data = await response.json();
    // write to json
    const today = `${now.getMonth() + 1}-${now.getDate()}`;
    if (storeJson) {
      const jsonPath = `../../../uber_data/uber_menu/json/${today}`;
      mkdirSync(jsonPath, { recursive: true });
      writeFileSync(
        `${jsonPath}/${latitude}_${longitude}_${shopUuid}-${today}.json`,
        JSON.stringify(data),
      );
    }
    return extractData(data.data, now, latitude, longitude, logger);
  } catch (e) {
    throw e;
  }
}
