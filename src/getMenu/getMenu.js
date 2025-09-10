import sendReqMenu from "./sendReqMenu.js";
import { Cookie } from "./Cookie.js";
import { mkdirSync, writeFileSync } from "fs";
import extractData from "./extractData.js";
import { Logger } from "../lib/Logger.js";

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
  let get = await fetch(
    "https://www.ubereats.com/tw/feed?diningMode=DELIVERY",
    // { verbose: true },
  );
  cookie.updateCookies(get.headers.getSetCookie().join("; "));
  cookie.setCookie("mcd_restaurant", "");

  let now = new Date();

  // fetch logic
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 5000));
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
