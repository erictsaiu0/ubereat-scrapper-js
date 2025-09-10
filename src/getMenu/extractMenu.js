import { Logger } from "../lib/Logger";

export default function getMenuData(data, logger) {
  const menu = extractMenu(data.catalogSectionsMap);
  const result = {
    uuid: [],
    product: [],
    description: [],
    price: [],               // 現價（item.price / 100）
    preDiscountPrice: [],    // 原價（抓不到為 NaN）
    isSoldOut: [],
    accessibilityText: [],
    popularityLabel: [],     // "most popular" | "popular" | "normal"
    // rating: [],              // 例如 "96%"；沒有就 NaN
    id: [],                  // item.uuid
    tags: [],                
    variationCode: [],       
  };

  for (const item of menu) {
    try {
      const uuid = item?.uuid ?? NaN;
      const title = strOrNaN(item?.title);
      const desc = strOrNaN(item?.itemDescription);

      const priceCents = typeof item?.price === "number" ? item.price : NaN;
      const price = Number.isFinite(priceCents) ? priceCents / 100 : NaN;

      const accText = strOrNaN(item?.priceTagline?.accessibilityText);

      // 原價（只解析折價前值）
      const preDiscountPrice = parseOriginalPrice(item);

      // rating（優先 endorsementMetadata.rating，再從 labelPrimary 補抓百分比）
      // const rating = parseRating(item);

      // 人氣標註（依規則）
      const popularityLabel = decidePopularityLabel(item, item?.__sectionTitle);

      // 新增：tags（彙整 → 直接存字串，做清理避免 CSV 格式問題）
      const tagsStr = collectTagsAsString(item);

      // === 寫回 ===
      result.uuid.push(uuid);
      result.product.push(title);
      result.description.push(desc);
      result.price.push(price);
      result.preDiscountPrice.push(preDiscountPrice);
      result.isSoldOut.push(typeof item?.isSoldOut === "boolean" ? item.isSoldOut : NaN);
      result.accessibilityText.push(accText);
      result.popularityLabel.push(popularityLabel);
      // result.rating.push(rating);

      // 新增欄位
      result.id.push(uuid);                 // 直接用品項 uuid
      result.tags.push(strOrNaN(tagsStr));  // 乾淨字串；若空則 NaN
      result.variationCode.push(NaN);       // 目前無變體代碼來源
    } catch (e) {
      logger?.error?.(e);
    }
  }
  return result;
}

function extractMenu(catalogSectionsMap) {
  const sections = Object.values(catalogSectionsMap || {});
  let menuItems = [];
  for (const section of sections) menuItems.push(...extractItems(section));
  return menuItems.flat();
}

function extractItems(section) {
  return (section || [])
    .map((e) => {
      const payload = Object.values(e?.payload || {})[0];
      const items = payload?.catalogItems;
      const sectionTitle = payload?.title?.text || "";
      if (!items) return null;
      return items.map((it) => ({ ...it, __sectionTitle: sectionTitle }));
    })
    .filter(Boolean);
}

function parseOriginalPrice(item) {
  try {
    const acc = item?.labelPrimary?.accessibilityText;
    if (acc) {
      const m = String(acc).match(/先前的價格為\s*\$([\d,]+(?:\.\d{1,2})?)/);
      if (m) return parseFloat(m[1].replace(/,/g, ""));
    }
  } catch {}
  try {
    const html = item?.priceTagline?.textFormat;
    if (html) {
      const text = stripHtml(html);
      const prices = [...text.matchAll(/\$([\d,]+(?:\.\d{1,2})?)/g)].map((m) => m[1]);
      if (prices.length >= 2) {
        // 通常最後一個是原價（刪除線）
        return parseFloat(prices[prices.length - 1].replace(/,/g, ""));
      }
    }
  } catch {}
  return NaN;
}

// rating：優先 endorsementMetadata.rating；否則從 labelPrimary.accessibilityText 補抓 "96%"
function parseRating(item) {
  try {
    const r1 = item?.catalogItemAnalyticsData?.endorsementMetadata?.rating;
    if (r1 != null) return String(r1);
  } catch {}
  try {
    const t = item?.labelPrimary?.accessibilityText;
    if (t) {
      const m = String(t).match(/(\d{1,3})\s*%/);
      if (m) return `${m[1]}%`;
    }
  } catch {}
  return NaN;
}

// popularityLabel：依規則輸出 most popular / popular / normal
function decidePopularityLabel(item, sectionTitle) {
  // 明確排名字樣 → most popular
  if (hasMostLikedRankText(item)) return "most popular";

  // 人氣/精選/Popular 區 或 most_liked → popular
  const inPopularSection = /人氣|精選|popular/i.test(sectionTitle || "");
  const emType = item?.catalogItemAnalyticsData?.endorsementMetadata?.endorsementType || "";
  if (inPopularSection || /most_liked/i.test(emType)) return "popular";

  // 其他 → normal
  return "normal";
}

function hasMostLikedRankText(item) {
  try {
    if (item?.endorsement?.text && /排名第\s*\d+\s*多的按讚數/.test(item.endorsement.text)) return true;
    if (
      item?.endorsement?.accessibilityText &&
      /排名第\s*\d+\s*多的按讚數/.test(item.endorsement.accessibilityText)
    )
      return true;
  } catch {}

  try {
    const overlays = item?.imageOverlayElements || [];
    for (const ov of overlays) {
      const tags = ov?.element?.payload?.tagsPayload?.tags || [];
      for (const t of tags) {
        if (t?.text && /排名第\s*\d+\s*多的按讚數/.test(t.text)) return true;
      }
    }
  } catch {}
  return false;
}

// 收集 tags 為「單一字串」，並清理以避免 CSV 儲存問題
function collectTagsAsString(item) {
  const list = [];

  try {
    const t1 = item?.endorsement?.text;
    const t2 = item?.endorsement?.accessibilityText;
    if (t1) list.push(String(t1));
    if (t2) list.push(String(t2));
  } catch {}

  try {
    const overlays = item?.imageOverlayElements || [];
    for (const ov of overlays) {
      const tags = ov?.element?.payload?.tagsPayload?.tags || [];
      for (const t of tags) if (t?.text) list.push(String(t.text));
    }
  } catch {}

  try {
    const et = item?.catalogItemAnalyticsData?.endorsementMetadata?.endorsementType;
    if (et) list.push(String(et)); // e.g. "most_liked", "ratings"
  } catch {}

  try {
    const acc = item?.titleBadge?.accessibilityText; // 可能含 "VEGETARIAN, VEGAN"
    if (acc) {
      const parts = String(acc).split(/[,，]/).map(s => s.trim()).filter(Boolean);
      if (parts.length) list.push(...parts);
    }
  } catch {}

  const uniq = Array.from(new Set(list.map(cleanTagPiece))).filter(Boolean);
  const joined = uniq.join(" | ");
  return cleanForCsv(joined);
}

// 單個片段清理：去 HTML、壓縮空白、去除換行、移除雙引號
function cleanTagPiece(s) {
  try {
    return stripHtml(String(s))
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/"/g, "")           // 避免與 CSV 外層引號衝突
      .trim();
  } catch {
    return "";
  }
}

// 整串再保險一次：去除不可見字元
function cleanForCsv(s) {
  try {
    return String(s).replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
  } catch {
    return "";
  }
}

// 工具：把字串（含空字串）轉為你習慣的格式（空字串→NaN，其餘加引號）
function strOrNaN(v) {
  if (v == null) return NaN;
  const s = String(v);
  return s.trim() === "" ? NaN : `"${s}"`;
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, " ");
}
