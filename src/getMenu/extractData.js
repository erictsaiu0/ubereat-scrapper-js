// extractData.js
import { Logger } from "../lib/Logger.js";
import getMenuData from "./extractMenu.js";

export default function extractData(data, now, latitude, longitude, logger) {
  let result = {
    shopCode: NaN,
    localtion: `"${JSON.stringify([latitude, longitude])}"`,
    updateDate: now.toLocaleDateString(),
    shopName: NaN,
    address: NaN,
    postalCode: NaN,
    shopLat: NaN,
    shopLng: NaN,
    city: NaN,
    pickupTime: NaN,
    deliverFee: NaN,
    rate: NaN,
    rateCt: NaN,
    storeAvailabilityStatus: NaN,
    catLst: NaN,
    chain: NaN,
    menu: NaN,
    popular: NaN,
  };

  // === 原本：uuid / title ===
  try {
    result.shopCode = data.uuid;
    if (data.title !== undefined) result.shopName = `"${data.title}"`;
  } catch (e) {
    return;
  }

  // === 原本：location（照舊，讀到什麼就寫什麼；允許空字串） ===
  try {
    const loc = data.location || {};
    if (loc.address !== undefined) result.address = `"${loc.address}"`;
    if (loc.postalCode !== undefined) result.postalCode = `"${loc.postalCode}"`;
    if (loc.city !== undefined) result.city = `"${loc.city}"`;
    if (loc.latitude !== undefined) result.shopLat = loc.latitude;
    if (loc.longitude !== undefined) result.shopLng = loc.longitude;
  } catch (e) {}

  // === 原本：等候時間 / 外送費（照舊） ===
  try { if (data.etaRange?.text !== undefined) result.pickupTime = `"${data.etaRange.text}"`; } catch (e) {}
  try { if (data.fareBadge?.text !== undefined) result.deliverFee = `"${data.fareBadge.text}"`; } catch (e) {}

  // === 原本：rating；reviewCount 保留字串 ===
  try {
    if (data.rating?.ratingValue !== undefined) result.rate = data.rating.ratingValue;
    if (data.rating?.reviewCount !== undefined) result.rateCt = `${data.rating.reviewCount}`;
  } catch (e) {}

  // === 小補強：營業狀態兩種鍵名擇一 ===
  try {
    const meta = data.storeInfoMetadata || {};
    const a = meta.storeAvailabilityStatus?.state;
    const b = meta.storeAvailablityStatus?.state;
    if (a !== undefined) result.storeAvailabilityStatus = a;
    else if (b !== undefined) result.storeAvailabilityStatus = b;
  } catch (e) {}

  // === 原本：categories / chain（照舊） ===
  try { result.catLst = Buffer.from(JSON.stringify(data.categories)).toString("base64"); } catch (e) {}
  try { result.chain = Buffer.from(JSON.stringify(data.parentChain)).toString("base64"); } catch (e) {}

  // === 原本：menu → base64（新版 getMenuData 內含 preDiscountPrice/popularityLabel/rating） ===
  try {
    const menu = getMenuData(data, logger)
    // console.log(menu);
    result.menu = Buffer.from(JSON.stringify(menu)).toString("base64"); 
  } catch (e) { logger?.error?.(e); }

  // === 原本：popular（店家層的「人氣區塊」保留舊行為，如後續要移除可再告訴我） ===
  // try {
  //   const popular = [];
  //   const sectionsMap = data?.catalogSectionsMap || {};
  //   Object.keys(sectionsMap).forEach((topKey) => {
  //     const sections = sectionsMap[topKey] || [];
  //     sections.forEach((section) => {
  //       const payload = section?.payload?.standardItemsPayload;
  //       if (!payload) return;
  //       const blockTitle = payload?.title?.text || "";
  //       if (!/人氣|精選|popular/i.test(blockTitle)) return;

  //       (payload.catalogItems || []).forEach((item) => {
  //         const endorsement = item?.catalogItemAnalyticsData?.endorsementMetadata;
  //         let rating = endorsement?.rating ?? null;
  //         let numRatings = endorsement?.numRatings ?? null;

  //         const labelAcc = item?.labelPrimary?.accessibilityText;
  //         if ((rating == null || numRatings == null) && labelAcc) {
  //           const m = String(labelAcc).match(/(\d{1,3})%\s*\((\d+)\)/);
  //           if (m) {
  //             rating = rating ?? `${m[1]}%`;
  //             numRatings = numRatings ?? parseInt(m[2], 10);
  //           }
  //         }

  //         popular.push({
  //           uuid: item?.uuid ?? null,
  //           title: item?.title ?? null,
  //           priceCents: item?.price ?? null,
  //           priceText: item?.priceTagline?.text ?? null,
  //           endorsementType: endorsement?.endorsementType ?? null,
  //           rating,
  //           numRatings,
  //           sectionTitle: blockTitle || null,
  //         });
  //       });
  //     });
  //   });

  //   result.popular = popular.length ? Buffer.from(JSON.stringify(popular)).toString("base64") : NaN;
  // } catch (e) {
  //   logger?.error?.(e);
  // }

  return result;
}
