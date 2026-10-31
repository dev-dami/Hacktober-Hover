// Reader: turns NAFDAC WordPress posts (recalls, safety alerts, watchlists) into structured alerts.
// Extraction is heuristic; every alert keeps its source URL and full text for review.

import { normalizeRegistrationNumber } from "../data/compare.ts";
import { attr, cleanText, decodeEntities, htmlToText, readTables } from "../lib/html.ts";

export const SITE_URL = "https://nafdac.gov.ng";

export interface WpPost {
  id: number;
  date: string;
  modified: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  categories: number[];
}

export interface AlertRegistrationNumber {
  number: string;
  /** The alert itself says this number is fake, non-existent or unregistered. */
  flaggedFake: boolean;
  context: string;
}

export interface AlertFile {
  url: string;
  /** Path relative to data/raw/alerts/, or null when not downloaded. */
  file: string | null;
}

export interface Alert {
  id: number;
  alertNumber: string | null;
  title: string;
  publishedAt: string;
  modifiedAt: string;
  url: string;
  categories: string[];
  issueTypes: string[];
  productTypes: string[];
  /** Key/value pairs from two-column detail tables, keys in snake_case. */
  fields: Record<string, string>;
  /** Rows of multi-column tables, keyed by the header row. */
  products: Record<string, string>[];
  productNames: string[];
  batchNumbers: string[];
  manufacturers: string[];
  registrationNumbers: AlertRegistrationNumber[];
  images: AlertFile[];
  attachments: AlertFile[];
  text: string;
}

const ISSUE_PATTERNS: [string, RegExp][] = [
  ["falsified", /falsif|counterfeit|fake|fraudulent/i],
  ["substandard", /substandard|out[- ]of[- ]specification|failed (?:quality|laboratory)/i],
  ["recall", /recall/i],
  ["unregistered", /unregistered|not registered|without (?:nafdac )?registration|unapproved/i],
  ["contaminated", /contaminat|adulterat|toxic|poison|diethylene|ethylene glycol/i],
  ["expired", /expired|tamper(?:ed|ing) expiry|relabel/i],
  ["watchlist", /watch-?list|blacklist/i],
  ["illegal_marketing", /illegal(?:ly)? (?:sale|market|distribut|import)|smuggl/i],
];

const PRODUCT_TYPE_PATTERNS: [string, RegExp][] = [
  ["drug", /medicine|\bdrugs?\b|tablet|capsule|syrup|suspension|injection|infusion|antibiotic|antimalarial|artemether|paracetamol|insulin|cough|ointment|eye drop|vial|ampoule/i],
  ["vaccine_biologic", /vaccine|biologic|serum|immunoglobulin|antivenom|blood/i],
  // Generic words (water, salt, sugar, sweet) are left out: in alerts they usually describe drugs.
  ["food", /\bfoods?\b|\bdrinks?\b|beverage|table water|sachet water|juice|noodle|\brice\b|\bmilk\b|infant formula|seasoning|bouillon|vegetable oil|palm oil|flour|\bwine\b|\bbeer\b|liquor|vodka|whisky|snack|biscuit|chocolate|tomato paste|cereal|energy drink|candy|confectioner/i],
  ["cosmetic", /cosmetic|cream|lotion|soap|shampoo|hair|skin|perfume|toothpaste|bleach|make-?up|lipstick/i],
  ["medical_device", /device|syringe|glove|test kit|condom|catheter|cannula|mask|thermometer|diagnostic/i],
  ["veterinary", /veterinary|animal|poultry|livestock|cattle/i],
  ["chemical", /chemical|pesticide|insecticide|herbicide|fumigant|sniper|dichlorvos/i],
];

const REG_NO = /\b([A-Z]{0,2}\d{1,2})\s?[-–]\s?(\d{3,6}[A-Z]?)\b/g;
const REG_KEYWORD = /NAFDAC|Reg(?:istration)?\.?\s*(?:No|Number|#)|NRN/i;
const FAKE_NEARBY = /fake|does not exist|not (?:been )?registered|unregistered|false|not genuine|not in the agency/i;
// Phrases in nearly every alert that would otherwise tag every alert as food AND drug.
const BOILERPLATE = [
  /National Agency for Foods? and Drugs? Administration and Control/gi,
  /\bNAFDAC\b/g,
  /Patent and Proprietary Medicines? Vendors?(?: \(PPMVs?\))?/gi,
  /healthcare (?:professionals|providers|institutions)/gi,
  /Drug Regulatory Authority of \w+/gi,
];
const ATTACHMENT_EXT = /\.(pdf|xlsx?|docx?|csv)(?:$|\?)/i;

export function toSnakeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function unique(values: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const trimmed = v.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase())) seen.set(trimmed.toLowerCase(), trimmed);
  }
  return [...seen.values()];
}

/** Values in detail fields or table columns whose key matches `keyPattern`. */
function valuesFor(fields: Record<string, string>, products: Record<string, string>[], keyPattern: RegExp): string[] {
  const fromFields = Object.entries(fields)
    .filter(([key]) => keyPattern.test(key))
    .map(([, value]) => value);
  const fromProducts = products.flatMap((row) =>
    Object.entries(row)
      .filter(([key]) => keyPattern.test(key))
      .map(([, value]) => value),
  );
  return [...fromFields, ...fromProducts].filter(
    (v) => v && !/^(n\/?a|nil|none|same as above.*|not (?:stated|declared|available|indicated).*)$/i.test(v),
  );
}

export function readTablesIntoRecords(html: string) {
  const fields: Record<string, string> = {};
  const products: Record<string, string>[] = [];
  for (const table of readTables(html)) {
    const twoColumn = table.every((row) => row.length === 2);
    if (twoColumn) {
      for (const [label = "", value = ""] of table) {
        const key = toSnakeKey(label);
        if (!key || !value || /^details?$/i.test(value)) continue;
        if (!(key in fields)) fields[key] = value;
      }
    } else if (table.length > 1) {
      const [header = [], ...rows] = table;
      const keys = header.map((h, i) => toSnakeKey(h) || `column_${i + 1}`);
      for (const row of rows) {
        const record: Record<string, string> = {};
        keys.forEach((key, i) => {
          if (row[i]) record[key] = row[i]!;
        });
        if (Object.keys(record).length > 0) products.push(record);
      }
    }
  }
  return { fields, products };
}

export function readRegistrationNumbers(text: string, fields: Record<string, string>): AlertRegistrationNumber[] {
  const found = new Map<string, AlertRegistrationNumber>();
  const add = (raw: string, context: string, flaggedFake: boolean) => {
    const number = normalizeRegistrationNumber(raw);
    const existing = found.get(number);
    if (existing) existing.flaggedFake ||= flaggedFake;
    else found.set(number, { number, flaggedFake, context });
  };

  for (const [key, value] of Object.entries(fields)) {
    if (!/nafdac|registration|reg_no|nrn/.test(key)) continue;
    for (const m of value.matchAll(REG_NO)) add(`${m[1]}-${m[2]}`, `${key}: ${value}`, FAKE_NEARBY.test(value));
  }
  for (const m of text.matchAll(REG_NO)) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 100), start);
    if (!REG_KEYWORD.test(before)) continue;
    // Only the words right after the number, stopping where another clause starts
    // ("…NRN B4-0328, while Visipaque is not registered" must not flag B4-0328).
    const after =
      text.slice(start + m[0].length, start + m[0].length + 60).split(/\.\s|;|\bwhile\b|\bwhereas\b|\band\b/i)[0] ?? "";
    const context = text.slice(Math.max(0, start - 80), start + m[0].length + 80).replace(/\s+/g, " ").trim();
    add(`${m[1]}-${m[2]}`, context, FAKE_NEARBY.test(after));
  }
  return [...found.values()];
}

function largestSrc(imgTag: string): string | null {
  const srcset = attr(imgTag, "srcset");
  if (srcset) {
    const candidates = srcset
      .split(",")
      .map((c) => c.trim().split(/\s+/))
      .map(([url = "", width = "0"]) => ({ url, width: parseInt(width, 10) || 0 }))
      .filter((c) => c.url);
    candidates.sort((a, b) => b.width - a.width);
    if (candidates[0]) return candidates[0].url;
  }
  return attr(imgTag, "src");
}

function absolute(url: string): string | null {
  try {
    const parsed = new URL(url, SITE_URL);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
}

export function readAlert(post: WpPost, categoryNames: ReadonlyMap<number, string>): Alert {
  const html = post.content.rendered;
  const title = cleanText(post.title.rendered);
  const text = htmlToText(html);
  const { fields, products } = readTablesIntoRecords(html);
  let lead = `${title}\n${text.slice(0, 700)}`;
  for (const phrase of BOILERPLATE) lead = lead.replace(phrase, " ");

  const images = unique(
    [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => absolute(largestSrc(tag) ?? "") ?? ""),
  ).map((url) => ({ url, file: null }));
  const attachments = unique(
    [...html.matchAll(/<a\b[^>]*>/gi)]
      .map(([tag]) => absolute(attr(tag, "href") ?? "") ?? "")
      .filter((url) => ATTACHMENT_EXT.test(url)),
  ).map((url) => ({ url, file: null }));

  const titleProduct = /(?:falsified|counterfeit|fake|substandard|recall of|unregistered)\s+(.+?)(?:\s+in (?:circulation|nigeria)|$)/i.exec(title)?.[1];

  return {
    id: post.id,
    alertNumber: /Public Alert No\.?\s*([0-9]+\s*\/\s*[0-9]{4})/i.exec(title)?.[1]?.replace(/\s+/g, "") ?? null,
    title,
    publishedAt: post.date,
    modifiedAt: post.modified,
    url: post.link,
    categories: post.categories.map((id) => decodeEntities(categoryNames.get(id) ?? String(id))),
    issueTypes: ISSUE_PATTERNS.filter(([, re]) => re.test(lead)).map(([name]) => name),
    productTypes: PRODUCT_TYPE_PATTERNS.filter(([, re]) => re.test(lead)).map(([name]) => name),
    fields,
    products,
    productNames: (() => {
      const named = valuesFor(fields, products, /^(product(_name)?|name_of_product|product_brand_name|brand_name|name)$/);
      const fallback = titleProduct && titleProduct.length <= 80 ? [titleProduct] : [];
      return unique(named.length ? named : fallback);
    })(),
    batchNumbers: unique(
      valuesFor(fields, products, /batch|lot/).flatMap((v) => v.split(/\s*(?:,|;|\band\b|\/(?=\s))\s*/)),
    ).filter((b) => /\d/.test(b) && b.length >= 3 && b.length <= 40),
    manufacturers: unique(valuesFor(fields, products, /manufacturer(?!s_address)(?!_address)|made_by/)),
    registrationNumbers: readRegistrationNumbers(text, fields),
    images,
    attachments,
    text,
  };
}
