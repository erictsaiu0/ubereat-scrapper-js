import sendReq from "./sendReq.js";
import { DataFrame } from "danfojs-node";
import { Cookie } from "./Cookie.js";
import { mkdirSync, writeFileSync } from "fs";
import { Logger } from "../lib/Logger.js";

/**
 * get the restaurants nearby the given latitude and longitude
 * @param {string} date today's string
 * @param {number} lat latitude
 * @param {number} lng longitude
 * @param {boolean} saveJson is should we save a json file in this run
 * @param {Logger} logger the logger used to logging
 */
export default async function getNearShop(
  date,
  lat = 25.0173405,
  lng = 121.5397518,
  saveJson,
  logger,
) {
  let result = {
    storeUuid: [],
    name: [],
    latitude: [],
    longitude: [],
    anchor_latitude: [],
    anchor_longitude: [],
    score_breakdown: [],
    score_total: [],
    rate: [],
    rateCt: [],
    orderable: [],
  };
  let cookie = new Cookie();
  cookie.init();

  const PAGE_SIZE = 80;

  let offset = 0;

  const fileNameStr = `../../../uber_data/shopLst/${date}/shopLst_${lat}_${lng}_${date}.csv`;

  await new Promise((resolve) => setTimeout(resolve, Math.random() * 4000));
  let get = await fetch(
    "https://www.ubereats.com/tw/feed?diningMode=DELIVERY",
    true,
  );
  cookie.updateCookies(get.headers.getSetCookie().join("; "));

  let roundCount = 0;

  while (true) {
    roundCount += 1;
    // wait for a couple seconds
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 3000));

    // send the request
    let response = await sendReq(cookie, lat, lng, offset, PAGE_SIZE, logger);
    if (!response) break;

    // update cookies
    cookie.updateCookies(response.headers.getSetCookie().join("; "));
    const data = await response.json();

    // store json
    if (saveJson) {
      try {
        const jsonPath = `../../../uber_data/shopLst/json/${date}/`;
        mkdirSync(jsonPath, { recursive: true });
        writeFileSync(
          `${jsonPath}/${lat}-${lng}-p-${offset}.json`,
          JSON.stringify(data),
        );
      } catch (error) {
        logger.error(error);
      }
    }

    try {
      let items = data["data"]["feedItems"];
      let stores = [];
      for (const e of items)
        if (e.type === "REGULAR_STORE") stores.push(e["store"]);

      if (!stores || stores.length < 1) break;
      offset += stores.length;

      for (const store of stores) {
        try {
          let uuid = store["storeUuid"];
          let title = store["title"]["text"];
          result.storeUuid.push(uuid);
          result.name.push(`\"${title}\"`);
        } catch (e) {
          continue;
        }

        try {
          let mapMarker = store["mapMarker"];
          result.latitude.push(mapMarker["latitude"]);
          result.longitude.push(mapMarker["longitude"]);
        } catch (e) {
          result.latitude.push(NaN);
          result.longitude.push(NaN);
        }

        try {
          let rating = store["rating"]["text"];
          result.rate.push(rating);
        } catch (e) {
          result.rate.push(NaN);
        }

        try {
          let rateCt = store["tracking"]["storePayload"]["ratingInfo"]["ratingCount"];
          result.rateCt.push(rateCt);
        } catch (e) {
          result.rateCt.push(NaN);
        }

        // the scores seems do something on the sorting order
        try {
          let score = store["tracking"]["storePayload"]["score"];
          result.score_breakdown.push(
            Buffer.from(JSON.stringify(score["breakdown"])).toString("base64"),
          );
          result.score_total.push(score["total"]);
        } catch (e) {
          result.score_breakdown.push(NaN);
        }

        try {
          let orderable = store["tracking"]["storePayload"]["isOrderable"];
          result.orderable.push(orderable);
        } catch (e) {
          result.orderable.push(NaN);
        }
      }
    } catch (error) {
      logger.error(error);
      break;
    }
  }

  // report
  logger.info(`(${lat},${lng}) ${result.storeUuid.length}`);
  if (result.storeUuid.length === 0) return;

  result.anchor_latitude = Array.from(
    { length: result.storeUuid.length },
    () => lat,
  );
  result.anchor_longitude = Array.from(
    { length: result.storeUuid.length },
    () => lng,
  );
  result.date = Array.from({ length: result.storeUuid.length }, () => date);
  new DataFrame(result).toCSV({ filePath: fileNameStr, header: true });
}
