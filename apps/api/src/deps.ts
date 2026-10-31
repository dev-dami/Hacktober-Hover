import type { Config } from "./config.ts";
import type { Datasets } from "./data.ts";
import type { Db } from "./db.ts";
import type { Ai } from "./gemma.ts";

/** Everything the routes need, injected so tests can swap in fakes. */
export interface Deps {
  config: Pick<Config, "dataDir" | "storageDir" | "adminToken" | "corsOrigins">;
  datasets: Datasets;
  db: Db;
  /** null when GEMINI_API_KEY is not set: AI endpoints answer 503, everything else works. */
  ai: Ai | null;
  now?: () => Date;
}
