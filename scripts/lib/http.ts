// Polite HTTP client shared by the crawlers: one request at a time, a fixed delay between
// requests, retries with backoff, and an on-disk cache so interrupted runs resume.

import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const USER_AGENT = "NAFDAC-Verify-Hackathon/0.1 (data collection; low request rate)";
const MAX_ATTEMPTS = 4;

export interface ClientOptions {
  delayMs: number;
  cacheDir: string;
}

export interface Client {
  /** GET text, cached under cacheDir/cacheKey. */
  get(url: string, cacheKey: string, headers?: Record<string, string>): Promise<string>;
  /** GET text plus selected response headers, cached together. */
  getWithHeaders(
    url: string,
    cacheKey: string,
    headerNames: string[],
    headers?: Record<string, string>,
  ): Promise<{ body: string; headers: Record<string, string | null> }>;
  /** Download a binary file to destPath; skipped when it already exists. Returns bytes written (0 if skipped). */
  download(url: string, destPath: string): Promise<number>;
  readonly networkRequests: number;
}

export function createClient({ delayMs, cacheDir }: ClientOptions): Client {
  let lastRequestAt = 0;
  let networkRequests = 0;

  async function throttle() {
    const wait = lastRequestAt + delayMs - Date.now();
    if (wait > 0) await Bun.sleep(wait);
    lastRequestAt = Date.now();
  }

  async function request(url: string, headers: Record<string, string>): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      await throttle();
      networkRequests++;
      let response: Response;
      try {
        response = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, ...headers },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS) throw new Error(`GET ${url} failed: ${error}`);
        await Bun.sleep(2_000 * 2 ** attempt);
        continue;
      }
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) {
        throw new Error(`GET ${url} -> HTTP ${response.status}`);
      }
      const retryAfter = Number(response.headers.get("retry-after"));
      await Bun.sleep(retryAfter > 0 ? retryAfter * 1_000 : 2_000 * 2 ** attempt);
    }
  }

  async function writeFile(path: string, data: string | ArrayBuffer) {
    await mkdir(dirname(path), { recursive: true });
    return Bun.write(path, data);
  }

  return {
    async get(url, cacheKey, headers = {}) {
      const cachePath = resolve(cacheDir, cacheKey);
      const cached = Bun.file(cachePath);
      if (await cached.exists()) return cached.text();
      const text = await (await request(url, headers)).text();
      await writeFile(cachePath, text);
      return text;
    },

    async getWithHeaders(url, cacheKey, headerNames, headers = {}) {
      const cachePath = resolve(cacheDir, `${cacheKey}.withheaders.json`);
      const cached = Bun.file(cachePath);
      if (await cached.exists()) return cached.json();
      const response = await request(url, headers);
      const result = {
        body: await response.text(),
        headers: Object.fromEntries(headerNames.map((h) => [h, response.headers.get(h)])),
      };
      await writeFile(cachePath, JSON.stringify(result));
      return result;
    },

    async download(url, destPath) {
      if (await Bun.file(destPath).exists()) return 0;
      const bytes = await (await request(url, {})).arrayBuffer();
      return writeFile(destPath, bytes);
    },

    get networkRequests() {
      return networkRequests;
    },
  };
}
