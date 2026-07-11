import sendReq from "./sendReq.js";
import { DataFrame } from "danfojs-node";
import { Cookie } from "./Cookie.js";
import { mkdirSync, writeFileSync } from "fs";
import { Logger } from "../lib/Logger.js";

const LOCATION_DELAY_MIN_MS = 3000;
const LOCATION_DELAY_MAX_MS = 6000;
const PAGE_DELAY_MIN_MS = 2500;
const PAGE_DELAY_MAX_MS = 4000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs, maxMs) {
  return minMs + Math.random() * (maxMs - minMs);
}

function headersToObject(headers) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    result[key] = value;
  }
  if (typeof headers.getSetCookie === "function") {
    result["set-cookie"] = headers.getSetCookie();
  }
  return result;
}

async function dumpResponse(date, lat, lng, offset, label, response, rawBody, logger) {
  try {
    const debugPath = `../../../uber_data/shopLst/debug/${date}/`;
    mkdirSync(debugPath, { recursive: true });
    writeFileSync(
      `${debugPath}/${lat}-${lng}-${label}-p-${offset}.json`,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          request: {
            latitude: lat,
            longitude: lng,
            offset,
          },
          response: {
            url: response.url,
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            redirected: response.redirected,
            type: response.type,
            headers: headersToObject(response.headers),
            body: rawBody,
          },
        },
        null,
        2,
      ),
    );
  } catch (error) {
    logger.error(error);
  }
}

/**
 * get the restaurants nearby the given latitude and longitude
 * @param {string} date today's string
 * @param {number} lat latitude
 * @param {number} lng longitude
 * @param {boolean} saveJson is should we save a json file in this run
 * @param {Logger} logger the logger used to logging
 * @param {boolean} debugResponse is should we save full response debug payloads
 */
export default async function getNearShop(
  date,
  lat = 25.0173405,
  lng = 121.5397518,
  saveJson,
  logger,
  debugResponse = false,
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
    promotioninfo: [],
    minDelTime: [],
    minFee: [],
    hasServiceFee: [],
  };
  let cookie = new Cookie();
  cookie.init();

  const PAGE_SIZE = 80;

  let offset = 0;

  const fileNameStr = `../../../uber_data/shopLst/${date}/shopLst_${lat}_${lng}_${date}.csv`;

  await sleep(randomDelay(LOCATION_DELAY_MIN_MS, LOCATION_DELAY_MAX_MS));
  let get = await fetch(
    "https://www.ubereats.com/tw/feed?diningMode=DELIVERY",
    true,
  );
  if (debugResponse) {
    await dumpResponse(date, lat, lng, 0, "feed", get, await get.text(), logger);
  }
  cookie.updateCookies(get.headers.getSetCookie().join("; "));

  let roundCount = 0;

  while (true) {
    roundCount += 1;
    // wait for a couple seconds
    await sleep(randomDelay(PAGE_DELAY_MIN_MS, PAGE_DELAY_MAX_MS));

    // send the request
    let response = await sendReq(cookie, lat, lng, offset, PAGE_SIZE, logger);
    if (!response) break;

    // update cookies
    cookie.updateCookies(response.headers.getSetCookie().join("; "));
    const rawBody = await response.text();
    if (debugResponse) {
      await dumpResponse(date, lat, lng, offset, "getFeedV1", response, rawBody, logger);
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch (error) {
      logger.error(
        `Failed to parse JSON response (${lat},${lng}) offset=${offset} status=${response.status}`,
      );
      logger.error(error);
      break;
    }

    if (!response.ok || data["status"] === "failure") {
      const message = data?.["data"]?.["message"] ?? data?.["message"] ?? "unknown";
      logger.error(
        `getFeedV1 failed (${lat},${lng}) offset=${offset} status=${response.status} message=${message}`,
      );
      break;
    }

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
      let items = data?.["data"]?.["feedItems"];
      if (!Array.isArray(items)) {
        logger.error(
          `Missing feedItems (${lat},${lng}) offset=${offset} status=${response.status} bodyStatus=${data?.["status"]}`,
        );
        break;
      }
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
            result.rateCt.push(rateCt.toString().replace(/,/g, ''));
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
          result.score_total.push(NaN);
        }

        try {
          let orderable = store["tracking"]["storePayload"]["isOrderable"];
          result.orderable.push(orderable);
        } catch (e) {
          result.orderable.push(NaN);
        }

        try {
          let minTime = NaN;
          const dropoffRange =
            store["tracking"]["storePayload"]["etdInfo"]["dropoffETARange"];
          if (dropoffRange) {
            if (typeof dropoffRange["min"] === "number") {
              minTime = dropoffRange["min"];
            } else if (typeof dropoffRange["raw"] === "number") {
              minTime = dropoffRange["raw"];
            }
          }
          if (Number.isNaN(minTime)) {
            const meta = store["meta"];
            if (Array.isArray(meta)) {
              const etdMeta = meta.find(
                (entry) => entry && entry["badgeType"] === "ETD",
              );
              if (etdMeta && typeof etdMeta["text"] === "string") {
                const match = etdMeta["text"].match(/\d+/);
                if (match) minTime = Number(match[0]);
              }
            }
          }
          result.minDelTime.push(minTime);
        } catch (e) {
          result.minDelTime.push(NaN);
        }

        try {
          let minFee = null;
          const meta = store["meta"];
          if (Array.isArray(meta)) {
            const fareMeta = meta.find(
              (entry) => entry && entry["badgeType"] === "FARE",
            );
            if (fareMeta) {
              const feeFromBadge = fareMeta?.badgeData?.fare?.deliveryFee;
              minFee =
                typeof feeFromBadge === "string" && feeFromBadge.length > 0
                  ? feeFromBadge
                  : typeof fareMeta["text"] === "string"
                    ? fareMeta["text"]
                    : null;
              if (typeof minFee === "string") {
                minFee = minFee.replace(/\s+/g, " ").trim();
              }
            }
          }
          result.minFee.push(minFee);
        } catch (e) {
          result.minFee.push(null);
        }

        try {
          let hasFee = NaN;
          const fareInfo = store["tracking"]["storePayload"]["fareInfo"];
          if (fareInfo) {
            const serviceFee = fareInfo["serviceFee"];
            const actual = fareInfo["actualServiceFee"];
            hasFee =
              (typeof serviceFee === "number" && serviceFee > 0) ||
              (actual &&
                ((typeof actual["high"] === "number" && actual["high"] > 0) ||
                  (typeof actual["low"] === "number" && actual["low"] > 0)));
          }
          result.hasServiceFee.push(hasFee);
        } catch (e) {
          result.hasServiceFee.push(NaN);
        }

        try {
          const signposts = store["signposts"];
          if (!Array.isArray(signposts) || signposts.length === 0) {
            result.promotioninfo.push(null);
          } else {
            const texts = signposts
              .map((item) => item && item["text"])
              .filter((text) => text != null)
              .map((text) =>
          text
            .toString()
            .replace(/[,\uFF0C]/g, "") // remove ASCII comma and fullwidth comma (，)
            .trim(),
              );
            result.promotioninfo.push(texts.length > 0 ? texts.join(" | ") : null);
          }
        } catch (e) {
          result.promotioninfo.push(null);
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
