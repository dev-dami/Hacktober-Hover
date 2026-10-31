import { resolve } from "node:path";
import { createApp } from "./app.ts";
import { loadConfig } from "./config.ts";
import { loadDatasets } from "./data.ts";
import { openDb } from "./db.ts";
import { createGemma } from "./gemma.ts";

const config = loadConfig();
const app = createApp(
  {
    config,
    datasets: await loadDatasets(config.dataDir),
    db: openDb(resolve(config.storageDir, "safemeds.sqlite")),
    ai: config.geminiApiKey ? createGemma(config.geminiApiKey, config.gemmaModel) : null,
  },
  { log: true },
);

if (!config.geminiApiKey) console.warn("[ai] GEMINI_API_KEY not set: scans save photos but fields must be typed by hand");
if (!config.adminToken) console.warn("[review] ADMIN_TOKEN not set: reviewer endpoints are disabled");
console.log(`SafeMeds NG API on http://localhost:${config.port}`);

export default { port: config.port, fetch: app.fetch, maxRequestBodySize: 50 * 1024 * 1024 };
