# SafeMeds NG

Scan a medicine, check it against official NAFDAC safety alerts and the Greenbook register,
get a plain-language explanation with sources, and report suspicious products.

| Part | What it is |
| --- | --- |
| `apps/api` | Backend: Hono on Bun. Scans (Gemma 4 label reading), checks, explanations, reports, reviewer API. SQLite storage. |
| `apps/nafdac-verify` | Frontend: Next.js. Scan flow, alert search, report form, receipt page, reviewer dashboard. |
| `scripts/` | Data collection: Greenbook crawler, NAFDAC alerts crawler, normalizer, Adaption training-set generator. |
| `data/` | Downloaded datasets. See [data/README.md](data/README.md). |

## Run it

```bash
bun install
cp apps/api/.env.example apps/api/.env          # add GEMINI_API_KEY and ADMIN_TOKEN
cp apps/nafdac-verify/.env.example apps/nafdac-verify/.env.local

# one-time data download (both resumable)
bun run data:crawl && bun run data:build        # Greenbook register -> data/processed
bun run data:alerts                             # NAFDAC alerts + photos -> data/raw/public-alerts.json

bun run dev                                     # API on :8787, web on :3000
```

`bun run test` runs the data-pipeline and API tests. `bun run build` / `bun run lint` check the frontend.

## Deploy on Render

[`render.yaml`](render.yaml) is a Render Blueprint for two services in Frankfurt:

| Service | What it runs | Plan |
| --- | --- | --- |
| `medfify-ng-api` | `bun apps/api/src/index.ts`, with a 1 GB disk at `/var/data` for SQLite and photos | Paid (a disk needs one) |
| `medfify-ng-web` | `next start` for the web app | Free |

1. In the Render Dashboard, select **New > Blueprint** and connect this repository.
2. Enter `GEMINI_API_KEY` when Render asks for it. Render generates `ADMIN_TOKEN`: copy it from the API's
   **Environment** page to sign in to `/reviewer`.
3. After the first deploy, compare the two `onrender.com` URLs with `CORS_ORIGINS` (API) and
   `NEXT_PUBLIC_API_URL` (web). If Render added a suffix to a name, update the value and redeploy the web app.
   `NEXT_PUBLIC_API_URL` is set at build time.

The alert and Greenbook data ship in `data/` in the repository, so the API needs no crawl on Render.

## How a check works

1. **Scan** (`POST /api/scans`): the photo is made upright, stripped of metadata (GPS), and saved.
2. **Verify** (`POST /api/scans/:id/verify`, streamed as Server-Sent Events): the verification agent
   (`apps/api/src/agent.ts`) reads the label with Gemma 4 (`gemma-4-26b-a4b-it`) until the key fields are
   confirmed, then checks them. See *The agent loop* below.
3. **Confirm** (`PATCH /api/scans/:id`): the person confirms or corrects the fields. The scan becomes
   *reviewed*: a labeled example for evaluating and later fine-tuning the reader.
4. **Check** (`POST /api/check`): deterministic code, not AI, compares the fields with
   - the Greenbook register (is the NAFDAC number registered, and to this product?), and
   - 412 NAFDAC recalls/alerts (batch numbers, fake registration numbers, product names, makers).
5. **Explain** (`POST /api/explain`): Gemma explains the result citing only the matched NAFDAC alerts.
6. **Feedback** (`POST /api/feedback`): "is this alert about your product?" and "was this helpful?".
7. **Report** (`POST /api/reports`): photos, batch, description, state/LGA. The reporter gets a private receipt
   link with an evidence pack.
8. **Review** (`/api/review/*`, needs `ADMIN_TOKEN`): reports grouped by product + batch; reviewers mark each
   matched alert relevant or not, and prepare a **NAFDAC submission** per group: Gemma drafts it from
   anonymised evidence, the reviewer edits, approves, sends it through NAFDAC's channels, and marks it sent
   (draft → approved → sent; sent reports become `forwarded_to_nafdac`). Nothing is sent automatically.
9. **Metrics** (`GET /api/review/metrics`, page `/review/metrics`): usage, agent outcomes and cost, reader
   accuracy against people's corrections, match precision from feedback, the offline eval, report pipeline.

## The agent loop

"Sure" is decided by code, never by the model's own confidence:

1. Two independent readings run in parallel: **fast** (thinking off, ~6 s) and **careful** (full thinking,
   ~25 s). The fast one is streamed at once with a preliminary check, so people see a result in seconds.
2. A key field (product name, batch, registration number) is *confirmed* only when both readings agree.
3. Disagreement or a one-sided reading triggers **one focused re-read** of just those fields (2-of-3 vote).
4. If nothing matched, Gemma suggests other names (generic, brand, spellings); the **same deterministic
   matcher** scores them, and anything found is only ever a "possible" match.
5. Still unconfirmed batch/registration number → the agent **asks for a close-up photo** with a specific hint
   (`POST /api/scans/:id/closeup`) instead of guessing.
6. Hard budget: 6 model calls, 150 s. When it runs out, unconfirmed fields are flagged for the person.

Every run is stored with its model calls (task, mode, latency, retries) for the metrics page.

`bun run eval:reader` measures the trade-off offline: fast vs careful vs the agent loop on real NAFDAC alert
photos (hits, wrong values, "verified but wrong", latency). Results land in `data/eval/latest.json` and on
the metrics page.

The app never declares a product genuine or counterfeit. A registry match confirms a registration, not a pack;
an alert match says the details match what NAFDAC reported. Only NAFDAC makes the call.

## Data limits

- Food, water and cosmetics registrations (NAPAMS) are not downloadable: NAPAMS only offers a single-number
  lookup behind a CAPTCHA. The app sends users there for non-drug products. NAFDAC alerts do cover food and
  cosmetics.
- Alert fields (batch numbers, fake numbers, product types) are extracted heuristically from NAFDAC's pages;
  every result links to the original alert.
