import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

export interface Config {
  port: number;
  /** Repo data directory with public-alerts.json, alerts/ files and processed Greenbook records. */
  dataDir: string;
  /** Where scans, report photos and the SQLite database are written. */
  storageDir: string;
  geminiApiKey: string | null;
  gemmaModel: string;
  /** Reviewer endpoints are disabled when unset. */
  adminToken: string | null;
  corsOrigins: string[];
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT ?? 8787),
    dataDir: resolve(env.DATA_DIR ?? resolve(REPO_ROOT, "data")),
    storageDir: resolve(env.STORAGE_DIR ?? resolve(import.meta.dir, "../storage")),
    geminiApiKey: env.GEMINI_API_KEY || null,
    // Gemma 4 on the Gemini API: gemma-4-26b-a4b-it (works) or gemma-4-31b-it (HTTP 500 for us on 2026-10-31).
    gemmaModel: env.GEMMA_MODEL || "gemma-4-26b-a4b-it",
    adminToken: env.ADMIN_TOKEN || null,
    corsOrigins: (env.CORS_ORIGINS ?? "http://localhost:3000").split(",").map((s) => s.trim()),
  };
}
