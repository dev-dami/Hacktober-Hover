// Crawl the NAFDAC Greenbook (medicines register) into the master dataset.
//   bun scripts/greenbook/crawl.ts                    full register
//   bun scripts/greenbook/crawl.ts --limit 200        first 200 products (by product_id)
//   --delay-ms 1500 --page-size 100 --max-details 300
//
// Writes:
//   data/raw/greenbook/products.json        trimmed Greenbook rows (provenance)
//   data/raw/greenbook/manufacturers.json   manufacturer id -> name
//   data/raw/greenbook/crawl.json           run metadata and completeness checks
//   data/raw/greenbook-products.csv         rows in the master CSV schema
// Responses are cached in .cache/greenbook/<date>/, so a re-run on the same day resumes.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { toCsv } from "../data/csv.ts";
import { CSV_COLUMNS } from "../data/schema.ts";
import { createClient } from "../lib/http.ts";
import {
  BASE_URL,
  productDetailsUrl,
  productsPageUrl,
  readManufacturerFromDetails,
  readManufacturersPage,
  readProductsPage,
  toProductRow,
  type GreenbookProduct,
} from "./reader.ts";

const ROOT = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    limit: { type: "string" },
    "page-size": { type: "string", default: "100" },
    "delay-ms": { type: "string", default: "1500" },
    "max-details": { type: "string", default: "300" },
    "out-dir": { type: "string", default: resolve(ROOT, "data/raw/greenbook") },
    csv: { type: "string", default: resolve(ROOT, "data/raw/greenbook-products.csv") },
  },
});

const today = new Date().toISOString().slice(0, 10);
const limit = values.limit ? Number(values.limit) : Infinity;
const pageSize = Number(values["page-size"]);
const client = createClient({
  delayMs: Number(values["delay-ms"]),
  cacheDir: resolve(ROOT, ".cache/greenbook", today),
});
const JSON_HEADERS = { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" };

// 1. Products, ordered by product_id so pages stay stable while we walk them.
const products = new Map<number, GreenbookProduct>();
let recordsTotal = 0;
for (let start = 0; start < Math.min(limit, recordsTotal || Infinity); start += pageSize) {
  const length = Math.min(pageSize, limit - start);
  const page = readProductsPage(
    await client.get(productsPageUrl(start, length), `products/${start}-${length}.json`, JSON_HEADERS),
  );
  recordsTotal = page.recordsTotal;
  if (page.data.length === 0) break;
  for (const product of page.data) products.set(product.product_id, product);
  console.log(`products ${products.size}/${Math.min(limit, recordsTotal)}`);
}

// 2. Manufacturer names from the paginated list.
const manufacturers = new Map<number, string>();
for (let page = 1; page <= 1000; page++) {
  const found = readManufacturersPage(
    await client.get(`${BASE_URL}/manufacturers?page=${page}`, `manufacturers/${page}.html`),
  );
  const before = manufacturers.size;
  for (const { id, name } of found) manufacturers.set(id, name);
  if (found.length === 0 || manufacturers.size === before) break;
  if (page % 5 === 0) console.log(`manufacturers ${manufacturers.size} (page ${page})`);
}
console.log(`manufacturers ${manufacturers.size}`);

// 3. Ids missing from the list: read one product details page per missing manufacturer.
const missing = new Map<number, number>(); // manufacturer_id -> sample product_id
for (const p of products.values()) {
  if (p.manufacturer_id != null && !manufacturers.has(p.manufacturer_id) && !missing.has(p.manufacturer_id)) {
    missing.set(p.manufacturer_id, p.product_id);
  }
}
const maxDetails = Number(values["max-details"]);
let detailsRead = 0;
const detailsFailed: number[] = [];
for (const [manufacturerId, productId] of missing) {
  if (detailsRead >= maxDetails) break;
  detailsRead++;
  try {
    const name = readManufacturerFromDetails(
      await client.get(productDetailsUrl(productId), `details/${productId}.html`),
    );
    if (name) manufacturers.set(manufacturerId, name);
  } catch (error) {
    // Some details pages return HTTP 500; leave that manufacturer blank rather than abort.
    detailsFailed.push(productId);
    console.warn(`  skipped: ${error instanceof Error ? error.message : error}`);
  }
}
if (missing.size) {
  console.log(
    `manufacturer fallback: ${missing.size} ids missing from the list, read ${detailsRead} details pages, ${detailsFailed.length} failed`,
  );
}

// 4. Write outputs.
const sorted = [...products.values()].sort((a, b) => a.product_id - b.product_id);
const rows = sorted.map((p) => toProductRow(p, manufacturers, today));
const withoutManufacturer = rows.filter((r) => !r.manufacturer).length;
const withoutRegNo = rows.filter((r) => !r.registration_number).length;

await mkdir(values["out-dir"], { recursive: true });
await Bun.write(resolve(values["out-dir"], "products.json"), `${JSON.stringify(sorted, null, 1)}\n`);
await Bun.write(
  resolve(values["out-dir"], "manufacturers.json"),
  `${JSON.stringify([...manufacturers].map(([id, name]) => ({ id, name })).sort((a, b) => a.id - b.id), null, 1)}\n`,
);
const meta = {
  source: BASE_URL,
  crawled_at: new Date().toISOString(),
  records_total_reported: recordsTotal,
  products_fetched: products.size,
  complete: Number.isFinite(limit) ? null : products.size === recordsTotal,
  manufacturers: manufacturers.size,
  manufacturer_ids_missing_from_list: missing.size,
  details_pages_failed: detailsFailed,
  rows_without_manufacturer: withoutManufacturer,
  rows_without_registration_number: withoutRegNo,
  network_requests: client.networkRequests,
};
await Bun.write(resolve(values["out-dir"], "crawl.json"), `${JSON.stringify(meta, null, 2)}\n`);
await Bun.write(values.csv, toCsv([[...CSV_COLUMNS], ...rows.map((r) => CSV_COLUMNS.map((c) => r[c]))]));

console.log(meta);
if (meta.complete === false) {
  console.warn(`Expected ${recordsTotal} products but fetched ${products.size}; re-run to resume.`);
}
console.log(`Wrote ${values.csv}`);
