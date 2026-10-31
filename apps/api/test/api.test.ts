import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { Alert, ProductRecord } from "../src/data.ts";
import { buildDatasets } from "../src/data.ts";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import type { Deps } from "../src/deps.ts";
import { EMPTY_FIELDS, type LabelFields } from "../src/fields.ts";
import { extractJsonObject, parseExtraction, type Ai } from "../src/gemma.ts";

// Shaped after real alerts 042/2026 (fake NRN 02-3457) and 025/2020 (falsified Zinnat lot 349R).
function alert(partial: Partial<Alert> & Pick<Alert, "id" | "title">): Alert {
  return {
    alertNumber: null,
    publishedAt: "2026-01-01T00:00:00",
    modifiedAt: "2026-01-01T00:00:00",
    url: `https://nafdac.gov.ng/alert-${partial.id}/`,
    categories: ["Recalls and Safety Alerts"],
    issueTypes: ["falsified"],
    productTypes: ["drug"],
    fields: {},
    products: [],
    productNames: [],
    batchNumbers: [],
    manufacturers: [],
    registrationNumbers: [],
    images: [],
    attachments: [],
    text: "",
    ...partial,
  };
}

const ALERTS: Alert[] = [
  alert({
    id: 1,
    alertNumber: "042/2026",
    title: "Alert on Falsified BPPL Artemether/Lumefantrine 80mg/480mg",
    productNames: ["Artemether/Lumefantrine 80mg/480mg"],
    batchNumbers: ["BP5203"],
    manufacturers: ["Bandaram Pharma Packleh Ltd (BPPL)"],
    registrationNumbers: [{ number: "02-3457", flaggedFake: true, context: "02-3457 (Fake)" }],
    text: "Verification confirmed that the NAFDAC Registration Number 02-3457 displayed on the product is fake.",
  }),
  alert({
    id: 2,
    alertNumber: "025/2020",
    title: "Alert on falsified Zinnat Suspension 125mg/5ml circulating in Nigeria",
    productNames: ["Zinnat Suspension 125mg/5ml"],
    batchNumbers: ["349R"],
    manufacturers: ["Glaxo Operations UK Ltd"],
    registrationNumbers: [{ number: "04-0463", flaggedFake: false, context: "NAFDAC Reg No 04-0463" }],
    text: "Falsified Zinnat Suspension, Lot Number 349R, in retail outlets.",
  }),
  alert({ id: 3, title: "Recall of Golden Penny Noodles", productTypes: ["food"], issueTypes: ["recall"], text: "noodles" }),
];

const PRODUCTS: ProductRecord[] = [
  {
    productName: "Zinnat Suspension",
    activeIngredients: ["Cefuroxime Axetil"],
    strength: "125 mg/5 ml",
    dosageForm: "Suspension",
    registrationNumber: "04-0463",
    manufacturer: "Glaxo Operations UK Ltd",
    applicant: "GlaxoSmithKline Pharmaceutical Nigeria Limited",
    category: "Drugs",
    approvalStatus: "Active",
    approvalDate: "2021-01-01",
    sourceUrl: "https://greenbook.nafdac.gov.ng/products/details/1",
    checkedAt: "2026-10-31",
    notes: null,
  },
];

const fields = (f: Partial<LabelFields>): LabelFields => ({ ...EMPTY_FIELDS, ...f });

const ZINNAT = fields({ productName: "Zinnat Suspension", batchNumber: "349R", registrationNumber: "04-0463" });
const fakeAi: Ai = {
  model: "fake-gemma",
  async extractLabel(_i, _m, o) {
    o?.log?.({ task: "read_label", mode: o.mode ?? "careful", ms: 5, attempts: 1, ok: true, thoughtTokens: 0, outputTokens: 1 });
    return { fields: ZINNAT, notes: null, raw: "{}" };
  },
  async rereadFields(_i, _m, wanted) {
    return Object.fromEntries(wanted.map((f) => [f, f === "batchNumber" ? "349R" : null]));
  },
  async suggestSearchTerms() {
    return [];
  },
  async explain(_f, result) {
    return { text: "Matches [1].", sources: result.alerts.slice(0, 1).map((a, i) => ({ n: i + 1, alertId: a.alertId, title: a.title, url: a.url })) };
  },
  async draftSubmission(evidence) {
    return `# Draft\n\n${evidence.split("\n")[0]}`;
  },
};

/** Parse a text/event-stream body into events. */
async function readSse(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim())
    .filter((d): d is string => !!d)
    .map((d) => JSON.parse(d));
}

const tempDirs: string[] = [];
async function makeApp(overrides: Partial<Deps> = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), "safemeds-"));
  tempDirs.push(storageDir);
  const deps: Deps = {
    config: { dataDir: storageDir, storageDir, adminToken: "secret", corsOrigins: ["http://localhost:3000"] },
    datasets: buildDatasets(ALERTS, PRODUCTS),
    db: openDb(":memory:"),
    ai: fakeAi,
    now: () => new Date("2026-10-31T12:00:00Z"),
    ...overrides,
  };
  return { app: createApp(deps), deps };
}
afterAll(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
});

const png = () => sharp({ create: { width: 60, height: 40, channels: 3, background: "#ffffff" } }).png().toBuffer();
const postJson = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("check", () => {
  test("strong match on the fake registration number from a real alert", async () => {
    const { app } = await makeApp();
    const res = await app.request("/api/check", postJson({ fields: fields({ productName: "Artemether Lumefantrine", registrationNumber: "02 - 3457" }) }));
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.alerts[0].alertId).toBe(1);
    expect(body.alerts[0].strength).toBe("strong");
    expect(body.alerts[0].reasons.join(" ")).toContain("fake");
    expect(body.registry.status).toBe("not_in_greenbook");
  });

  test("batch + name match, registered number, never claims authenticity", async () => {
    const { app } = await makeApp();
    const res = await app.request(
      "/api/check",
      postJson({ fields: fields({ productName: "ZINNAT suspension", batchNumber: "Lot: 349 R", registrationNumber: "04-0463" }) }),
    );
    const body = await res.json() as any;
    expect(body.alerts[0].alertId).toBe(2);
    expect(body.alerts[0].strength).toBe("strong");
    expect(body.registry.status).toBe("registered");
    expect(body.summary).toContain("cannot prove");
  });

  test("registration numbers match however they were written (spaces, dashes)", async () => {
    const { app } = await makeApp();
    for (const written of ["04 0463", "04–0463", "040463"]) {
      const body = await (await app.request("/api/check", postJson({ fields: fields({ productName: "Zinnat", registrationNumber: written }) }))).json() as any;
      expect(body.registry.status).toBe("registered");
    }
  });

  test("a different batch of the same product is only a possible match", async () => {
    const { app } = await makeApp();
    const body = await (await app.request("/api/check", postJson({ fields: fields({ productName: "Zinnat Suspension", batchNumber: "777X" }) }))).json() as any;
    expect(body.alerts[0].alertId).toBe(2);
    expect(body.alerts[0].strength).toBe("possible");
  });

  test("label details that differ from the registered product are flagged", async () => {
    const { app } = await makeApp();
    const body = await (await app.request("/api/check", postJson({ fields: fields({ productName: "Amoxil", registrationNumber: "04-0463" }) }))).json() as any;
    expect(body.registry.status).toBe("registered_details_differ");
  });

  test("unrelated product has no matches", async () => {
    const { app } = await makeApp();
    const body = await (await app.request("/api/check", postJson({ fields: fields({ productName: "Panadol Extra" }) }))).json() as any;
    expect(body.alerts).toEqual([]);
  });

  test("rejects malformed input", async () => {
    const { app } = await makeApp();
    expect((await app.request("/api/check", postJson({ fields: "nope" }))).status).toBe(400);
  });
});

describe("alerts", () => {
  test("search and filter by product type", async () => {
    const { app } = await makeApp();
    expect((await (await app.request("/api/alerts?q=zinnat")).json() as any).results.map((r: { id: number }) => r.id)).toEqual([2]);
    expect((await (await app.request("/api/alerts?type=food")).json() as any).results.map((r: { id: number }) => r.id)).toEqual([3]);
    expect((await app.request("/api/alerts/999")).status).toBe(404);
    expect((await app.request("/api/alerts/files/../../secret")).status).toBe(404);
  });
});

describe("scans", () => {
  async function upload(app: Awaited<ReturnType<typeof makeApp>>["app"]) {
    const form = new FormData();
    form.append("image", new File([await png()], "label.png", { type: "image/png" }));
    const res = await app.request("/api/scans", { method: "POST", body: form });
    expect(res.status).toBe(201);
    return (await res.json()) as any;
  }

  test("upload, streamed verification, run stored, then the person's correction marks it reviewed", async () => {
    const { app, deps } = await makeApp();
    const scan = await upload(app);
    expect(deps.db.getScan(scan.id)?.status).toBe("unreviewed");
    expect((await app.request(scan.imageUrl)).headers.get("content-type")).toBe("image/jpeg");

    const res = await app.request(`/api/scans/${scan.id}/verify`, { method: "POST" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSse(res);
    expect(events.map((e) => e.type)).toContain("check");
    const done = events.at(-1);
    expect(done.type).toBe("done");
    expect(done.summary.status).toBe("verified");
    expect(deps.db.latestRun(scan.id)?.status).toBe("verified");
    expect(deps.db.getScan(scan.id)?.extracted?.batchNumber).toBe("349R");

    const patch = await app.request(`/api/scans/${scan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { ...ZINNAT, expiryDate: "05/2027" } }),
    });
    expect(patch.status).toBe(200);
    expect(deps.db.getScan(scan.id)?.corrected?.expiryDate).toBe("05/2027");
  });

  test("close-up requires an earlier run, then streams a follow-up", async () => {
    const { app } = await makeApp();
    const scan = await upload(app);
    const closeup = () => {
      const form = new FormData();
      form.append("image", new File([new Uint8Array(0)], "c.png", { type: "image/png" }));
      return form;
    };
    expect((await app.request(`/api/scans/${scan.id}/closeup`, { method: "POST", body: closeup() })).status).toBe(409);
    await readSse(await app.request(`/api/scans/${scan.id}/verify`, { method: "POST" }));
    const form = new FormData();
    form.append("image", new File([await png()], "c.png", { type: "image/png" }));
    form.append("fields", JSON.stringify(["batchNumber"]));
    const events = await readSse(await app.request(`/api/scans/${scan.id}/closeup`, { method: "POST", body: form }));
    expect(events.at(-1).type).toBe("done");
  });

  test("without an AI key the photo is still saved and the user is told to type details", async () => {
    const { app } = await makeApp({ ai: null });
    const scan = await upload(app);
    expect(scan.aiAvailable).toBe(false);
    expect(scan.aiError).toContain("GEMINI_API_KEY");
    expect((await app.request(`/api/scans/${scan.id}/verify`, { method: "POST" })).status).toBe(503);
    expect((await app.request("/api/explain", postJson({ fields: fields({}) }))).status).toBe(503);
  });

  test("feedback on alerts and explanations is stored", async () => {
    const { app, deps } = await makeApp();
    const scan = await upload(app);
    const ok = await app.request(
      "/api/feedback",
      postJson({ kind: "alert_relevance", scanId: scan.id, alertId: 2, matchStrength: "strong", value: "not_relevant" }),
    );
    expect(ok.status).toBe(201);
    expect((await app.request("/api/feedback", postJson({ kind: "explanation_rating", value: "meh" }))).status).toBe(400);
    expect(deps.db.listFeedback()[0]?.value).toBe("not_relevant");
  });

  test("rejects non-images", async () => {
    const { app } = await makeApp();
    const form = new FormData();
    form.append("image", new File(["hello"], "x.png", { type: "image/png" }));
    expect((await app.request("/api/scans", { method: "POST", body: form })).status).toBe(400);
  });
});

describe("reports", () => {
  async function submit(app: Awaited<ReturnType<typeof makeApp>>["app"], extra: Record<string, unknown> = {}, photos = 1) {
    const form = new FormData();
    form.append(
      "report",
      JSON.stringify({
        fields: fields({ productName: "Zinnat Suspension", batchNumber: "349R" }),
        description: "Child got no better after a full course; bottle looks different.",
        state: "Lagos",
        lga: "Ikeja",
        contact: "0800 000 0000",
        consent: true,
        ...extra,
      }),
    );
    for (let i = 0; i < photos; i++) form.append("photos", new File([await png()], `p${i}.png`, { type: "image/png" }));
    return app.request("/api/reports", { method: "POST", body: form });
  }

  test("submit, read back with receipt token (contact hidden), evidence pack cites alerts", async () => {
    const { app } = await makeApp();
    const res = await submit(app);
    expect(res.status).toBe(201);
    const { id, receiptToken } = await res.json() as any;

    expect((await app.request(`/api/reports/${id}`)).status).toBe(404);
    const mine = await (await app.request(`/api/reports/${id}?token=${receiptToken}`)).json() as any;
    expect(mine.contact).toBeUndefined();
    expect(mine.photos).toEqual(["photo-1.jpg"]);
    expect(mine.evidence.markdown).toContain("https://nafdac.gov.ng/alert-2/");
    expect(mine.evidence.markdown).toContain("does not\nstate that the product is counterfeit");
  });

  test("requires consent and a description", async () => {
    const { app } = await makeApp();
    expect((await submit(app, { consent: false })).status).toBe(400);
    expect((await submit(app, { description: "bad" })).status).toBe(400);
    expect((await submit(app, {}, 5)).status).toBe(400);
  });

  test("reviewers see reports grouped by product and batch; access needs the token", async () => {
    const { app } = await makeApp();
    await submit(app);
    await submit(app, { fields: fields({ productName: "suspension ZINNAT", batchNumber: "349-r" }), state: "Kano" });
    await submit(app, { fields: fields({ productName: "Zinnat Suspension", batchNumber: "999A" }) });

    expect((await app.request("/api/review/groups")).status).toBe(401);
    const auth = { headers: { Authorization: "Bearer secret" } };
    const { groups } = await (await app.request("/api/review/groups", auth)).json() as any;
    expect(groups[0].reportCount).toBe(2);
    expect(groups[0].states.sort()).toEqual(["Kano", "Lagos"]);
    expect(groups).toHaveLength(2);

    const id = groups[0].reportIds[0];
    const full = await (await app.request(`/api/review/reports/${id}`, auth)).json() as any;
    expect(full.contact).toBeTruthy();
    const photo = await app.request(`/api/review/reports/${id}/photos/photo-1.jpg`, auth);
    expect(photo.status).toBe(200);

    const patch = await app.request(`/api/review/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
      body: JSON.stringify({ status: "in_review" }),
    });
    expect(patch.status).toBe(200);
  });

  test("verdicts, NAFDAC submission lifecycle (draft -> approved -> sent), anonymised evidence, metrics", async () => {
    const { app, deps } = await makeApp();
    await submit(app, { description: "Bitter taste, call me on 08031234567 or ada@example.com" });
    await submit(app, { state: "Kano" });
    const H = { "Content-Type": "application/json", Authorization: "Bearer secret" };
    const { groups } = await (await app.request("/api/review/groups", { headers: H })).json() as any;
    const group = groups[0];
    const reportId = group.reportIds[0];

    const verdict = await app.request(`/api/review/reports/${reportId}/alerts/2/verdict`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ value: "confirmed" }),
    });
    expect(verdict.status).toBe(201);
    expect((await app.request(`/api/review/reports/${reportId}/alerts/999/verdict`, { method: "POST", headers: H, body: JSON.stringify({ value: "confirmed" }) })).status).toBe(404);

    const created = await app.request(`/api/review/groups/${encodeURIComponent(group.key)}/submission`, { method: "POST", headers: H });
    expect(created.status).toBe(201);
    const draft = await created.json() as any;
    expect(draft.status).toBe("draft");
    expect(draft.evidence).not.toContain("08031234567");
    expect(draft.evidence).not.toContain("ada@example.com");
    expect(draft.evidence).not.toContain("0800 000 0000");
    expect(draft.evidence).toContain("Number of reports: 2");
    expect(draft.evidence).toContain("reviewer confirmed relevant in 1 of 1");

    const patch = (body: unknown) => app.request(`/api/review/submissions/${draft.id}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
    expect((await app.request(`/api/review/submissions/${draft.id}/export`, { headers: H })).status).toBe(409);
    expect((await patch({ status: "sent" })).status).toBe(409);
    expect((await patch({ markdown: "# Edited submission for NAFDAC review" })).status).toBe(200);
    expect((await patch({ status: "approved" })).status).toBe(200);
    expect((await patch({ markdown: "# Sneaky edit after approval" })).status).toBe(409);
    expect((await patch({ status: "sent", sentNote: "Emailed to NAFDAC PV desk" })).status).toBe(200);
    expect((await patch({ status: "draft" })).status).toBe(409);
    const exported = await app.request(`/api/review/submissions/${draft.id}/export`, { headers: H });
    expect(await exported.text()).toBe("# Edited submission for NAFDAC review");
    expect(deps.db.getReport(reportId)?.status).toBe("forwarded_to_nafdac");

    const metrics = await (await app.request("/api/review/metrics", { headers: H })).json() as any;
    expect(metrics.usage.reports).toBe(2);
    expect(metrics.reports.submissions).toEqual({ sent: 1 });
    expect(metrics.feedback.reviewerAlertVerdicts.strong).toEqual({ n: 1, precision: 100 });
    expect(metrics.reports.byState).toEqual({ Lagos: 1, Kano: 1 });
  });

  test("reviewer endpoints are off without ADMIN_TOKEN", async () => {
    const { app, deps } = await makeApp();
    deps.config.adminToken = null;
    expect((await app.request("/api/review/groups", { headers: { Authorization: "Bearer secret" } })).status).toBe(503);
  });
});

describe("gemma reply parsing", () => {
  test("reads JSON inside code fences and chatter, maps 'null' strings", () => {
    const reply = 'Here you go:\n```json\n{"productName": "Zinnat {125}", "batchNumber": "null", "notes": "smudged"}\n```';
    expect(extractJsonObject(reply)).toEqual({ productName: "Zinnat {125}", batchNumber: "null", notes: "smudged" });
    const parsed = parseExtraction(reply);
    expect(parsed.fields.productName).toBe("Zinnat {125}");
    expect(parsed.fields.batchNumber).toBeNull();
    expect(parsed.notes).toBe("smudged");
  });
  test("throws when there is no JSON", () => {
    expect(() => parseExtraction("I cannot read this image.")).toThrow();
  });
});

