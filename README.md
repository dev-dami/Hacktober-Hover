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

## How a check works

1. **Scan** (`POST /api/scans`): the photo is made upright, stripped of metadata (GPS), and saved.
   Gemma 4 (`gemma-4-26b-a4b-it` via the Gemini API) reads the label into fields. The photo and reading are
   stored as an *unreviewed* example.
2. **Confirm** (`PATCH /api/scans/:id`): the person corrects the fields. The scan becomes *reviewed*,
   i.e. a labeled training example for improving the reader later.
3. **Check** (`POST /api/check`): deterministic code, not AI, compares the fields with
   - the Greenbook register (is the NAFDAC number registered, and to this product?), and
   - 412 NAFDAC recalls/alerts (batch numbers, fake registration numbers, product names, makers).
4. **Explain** (`POST /api/explain`): Gemma explains the result citing only the matched NAFDAC alerts.
5. **Report** (`POST /api/reports`): photos, batch, description, state/LGA. The reporter gets a private receipt
   link with an evidence pack to send to NAFDAC.
6. **Review** (`/api/review/*`, needs `ADMIN_TOKEN`): reports grouped by product + batch.

The app never declares a product genuine or counterfeit. A registry match confirms a registration, not a pack;
an alert match says the details match what NAFDAC reported. Only NAFDAC makes the call.

## Data limits

- Food, water and cosmetics registrations (NAPAMS) are not downloadable: NAPAMS only offers a single-number
  lookup behind a CAPTCHA. The app sends users there for non-drug products. NAFDAC alerts do cover food and
  cosmetics.
- Alert fields (batch numbers, fake numbers, product types) are extracted heuristically from NAFDAC's pages;
  every result links to the original alert.
