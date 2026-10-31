// Download NAFDAC recalls, safety alerts, watchlists and warning letters via the public
// WordPress REST API on nafdac.gov.ng, plus their product photos and attached documents.
//   bun scripts/nafdac-alerts/crawl.ts               everything
//   bun scripts/nafdac-alerts/crawl.ts --skip-files  JSON only, no photos/documents
//   --delay-ms 1000
//
// Writes:
//   data/raw/public-alerts.json        structured alerts (see scripts/nafdac-alerts/reader.ts)
//   data/raw/alerts/images/<id>/...    product photos
//   data/raw/alerts/files/<id>/...     attached PDFs/spreadsheets
//   data/raw/alerts/crawl.json         run metadata
// API responses are cached in .cache/nafdac-alerts/<date>/.

import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "../lib/http.ts";
import { readAlert, SITE_URL, type Alert, type AlertFile, type WpPost } from "./reader.ts";

const ROOT = resolve(import.meta.dir, "../..");
// Category slugs on nafdac.gov.ng that hold product alerts.
const ALERT_CATEGORY_SLUGS = ["recalls-and-alerts", "watchlist-and-blacklist", "warning-letters"];

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "delay-ms": { type: "string", default: "1000" },
    "skip-files": { type: "boolean", default: false },
    output: { type: "string", default: resolve(ROOT, "data/raw/public-alerts.json") },
    "files-dir": { type: "string", default: resolve(ROOT, "data/raw/alerts") },
  },
});

const today = new Date().toISOString().slice(0, 10);
const client = createClient({
  delayMs: Number(values["delay-ms"]),
  cacheDir: resolve(ROOT, ".cache/nafdac-alerts", today),
});
const api = (path: string) => `${SITE_URL}/wp-json/wp/v2/${path}`;

// 1. Categories (id -> name), then the ids for alert categories.
const categories = JSON.parse(
  await client.get(api("categories?per_page=100&_fields=id,name,slug,count"), "categories.json"),
) as { id: number; name: string; slug: string; count: number }[];
const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
const alertCategories = categories.filter((c) => ALERT_CATEGORY_SLUGS.includes(c.slug));
if (alertCategories.length === 0) throw new Error("No alert categories found; the site structure may have changed");
console.log("categories:", alertCategories.map((c) => `${c.name} (${c.count})`).join(", "));

// 2. Posts, 100 per page.
const ids = alertCategories.map((c) => c.id).join(",");
const fields = "id,date,modified,link,title,content,categories";
const posts: WpPost[] = [];
for (let page = 1, totalPages = 1; page <= totalPages; page++) {
  const { body, headers } = await client.getWithHeaders(
    api(`posts?categories=${ids}&per_page=100&page=${page}&orderby=date&order=desc&_fields=${fields}`),
    `posts/${ids}-${page}.json`,
    ["x-wp-totalpages", "x-wp-total"],
  );
  totalPages = Number(headers["x-wp-totalpages"] ?? 1);
  posts.push(...(JSON.parse(body) as WpPost[]));
  console.log(`posts ${posts.length}/${headers["x-wp-total"]}`);
}

const alerts: Alert[] = posts.map((p) => readAlert(p, categoryNames));

// 3. Photos and attachments.
let downloaded = 0;
let bytes = 0;
const failed: string[] = [];
async function fetchFile(alert: Alert, item: AlertFile, kind: "images" | "files") {
  const name = basename(new URL(item.url).pathname).replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
  const relative = `${kind}/${alert.id}/${name}`;
  try {
    const written = await client.download(item.url, resolve(values["files-dir"], relative));
    item.file = relative;
    if (written > 0) {
      downloaded++;
      bytes += written;
    }
  } catch (error) {
    failed.push(item.url);
    console.warn(`  skipped ${item.url}: ${error instanceof Error ? error.message : error}`);
  }
}
if (!values["skip-files"]) {
  const total = alerts.reduce((n, a) => n + a.images.length + a.attachments.length, 0);
  console.log(`downloading ${total} photos/documents (already-downloaded files are skipped)`);
  for (const [index, alert] of alerts.entries()) {
    for (const image of alert.images) await fetchFile(alert, image, "images");
    for (const attachment of alert.attachments) await fetchFile(alert, attachment, "files");
    if ((index + 1) % 50 === 0) console.log(`files: ${index + 1}/${alerts.length} alerts done`);
  }
}

// 4. Write outputs.
const count = (pick: (a: Alert) => string[]) => {
  const out: Record<string, number> = {};
  for (const a of alerts) for (const v of pick(a)) out[v] = (out[v] ?? 0) + 1;
  return out;
};
const meta = {
  source: `${SITE_URL}/wp-json/wp/v2/posts`,
  crawled_at: new Date().toISOString(),
  categories: alertCategories.map((c) => ({ id: c.id, name: c.name, count: c.count })),
  alerts: alerts.length,
  oldest: alerts.at(-1)?.publishedAt ?? null,
  newest: alerts[0]?.publishedAt ?? null,
  with_registration_numbers: alerts.filter((a) => a.registrationNumbers.length).length,
  with_fake_registration_numbers: alerts.filter((a) => a.registrationNumbers.some((r) => r.flaggedFake)).length,
  with_batch_numbers: alerts.filter((a) => a.batchNumbers.length).length,
  issue_types: count((a) => a.issueTypes),
  product_types: count((a) => a.productTypes),
  files_downloaded_this_run: downloaded,
  bytes_downloaded_this_run: bytes,
  files_failed: failed,
  network_requests: client.networkRequests,
};
await mkdir(values["files-dir"], { recursive: true });
await Bun.write(values.output, `${JSON.stringify(alerts, null, 1)}\n`);
await Bun.write(resolve(values["files-dir"], "crawl.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(meta);
console.log(`Wrote ${values.output}`);
