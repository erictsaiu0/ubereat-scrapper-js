import sendReqMenu from "./sendReqMenu.js";
import { Cookie } from "./Cookie.js";
import { mkdirSync, writeFileSync } from "fs";
import extractData from "./extractData.js";
import { Logger } from "../lib/Logger.js";

const FEED_DELAY_MIN_MS = 3000;
const FEED_DELAY_MAX_MS = 5000;
const MENU_DELAY_MIN_MS = 4000;
const MENU_DELAY_MAX_MS = 6000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs);
}

export async function initializeMenuSession(cookie) {
  await sleep(randomDelay(FEED_DELAY_MIN_MS, FEED_DELAY_MAX_MS));

  const response = await fetch(
    "https://www.ubereats.com/tw/feed?diningMode=DELIVERY",
  );

  if (!response.ok) {
    const error = new Error(
      `Feed request failed with HTTP ${response.status}`,
    );
    error.code = response.status === 429
      ? "UBER_RATE_LIMIT"
      : "UBER_HTTP_ERROR";
    error.httpStatus = response.status;
    throw error;
  }

  cookie.updateCookies(response.headers.getSetCookie().join("; "));
  cookie.setCookie("mcd_restaurant", "");
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

    const botDefense = data?.metadata?.botdefense;

    if (botDefense?.state === "challenge") {
      const error = new Error(
        `Uber bot defense challenge (${botDefense.provider ?? "unknown"})`,
      );
      error.code = "UBER_BOT_CHALLENGE";
      error.httpStatus = response.status;
      error.responseData = data;
      throw error;
    }

    if (!response.ok || data?.status === "failure") {
      const error = new Error(
        `getStoreV1 failed: HTTP ${response.status}, ` +
          `status=${data?.status ?? "unknown"}`,
      );
      error.code = response.status === 429
        ? "UBER_RATE_LIMIT"
        : "UBER_API_ERROR";
      error.httpStatus = response.status;
      error.responseData = data;
      throw error;
    }

    return extractData(data.data, now, latitude, longitude, logger);
  } catch (e) {
    throw e;
  }
}
