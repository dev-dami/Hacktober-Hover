import { describe, expect, test } from "bun:test";
import { demoRecords } from "@hacktober/verify-core";
import { SAMPLE_ALERTS, filterAlerts } from "./alerts";
import { DEMO_PACKS, extractLabel, extractWithConfidence } from "./extract";
import { formatDate, formatExpiry } from "./format";
import { createJsonStore, parseJson, type KeyValueStorage } from "./json-store";
import { dosageGroup, initials, searchRecords } from "./lookup";
import { createHistoryStore, createSessionStore, prependHistory, type HistoryEntry } from "./stores";
import { runCheck } from "./verify";

const TODAY = "2026-10-31";

function fakeStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("extractLabel", () => {
  test("demo packs return fixed fields", async () => {
    const match = await extractLabel({ kind: "demo", id: "DEMO-0001" });
    expect(match.registrationNumber).toBe("DEMO-0001");
    const mismatch = await extractLabel({ kind: "demo", id: "DEMO-0003" });
    expect(mismatch).toMatchObject({
      manufacturer: "Demo Pharmaceuticals Ltd",
      strength: "500 mg",
      expiryDate: "2026-03",
    });
  });

  test("returns a copy so callers cannot mutate the fixture", async () => {
    const label = await extractLabel({ kind: "demo", id: "DEMO-0001" });
    label.productName = "changed";
    expect(DEMO_PACKS[0]?.label.productName).toBe("SampleMed 500");
  });

  test("photos flag the manufacturer as low confidence", async () => {
    const result = await extractWithConfidence({ kind: "photo", image: new Blob(["x"]) });
    expect(result.lowConfidence).toEqual(["manufacturer"]);
  });
});

describe("runCheck with demo packs", () => {
  test("DEMO-0001 matches the record", async () => {
    const label = await extractLabel({ kind: "demo", id: "DEMO-0001" });
    const check = runCheck(label, demoRecords, TODAY);
    expect(check.verdict.label).toBe("record_match");
    expect(check.rows.every((row) => row.status === "match")).toBe(true);
  });

  test("DEMO-0003 mismatches on manufacturer and strength and warns about expiry", async () => {
    const label = await extractLabel({ kind: "demo", id: "DEMO-0003" });
    const check = runCheck(label, demoRecords, TODAY);
    expect(check.verdict.label).toBe("record_mismatch");
    expect(check.verdict.warnings).toContain("expired_packaging");
    const differing = check.rows.filter((row) => row.status === "differ").map((row) => row.field);
    expect(differing).toEqual(["manufacturer", "strength"]);
  });

  test("unknown registration number gives not_found", async () => {
    const label = { ...(await extractLabel({ kind: "demo", id: "DEMO-0001" })), registrationNumber: "DEMO-9999" };
    const check = runCheck(label, demoRecords, TODAY);
    expect(check.verdict.label).toBe("not_found");
    expect(check.record).toBeNull();
  });

  test("missing registration number gives unverified with a warning", async () => {
    const label = { ...(await extractLabel({ kind: "demo", id: "DEMO-0001" })), registrationNumber: null };
    const check = runCheck(label, demoRecords, TODAY);
    expect(check.verdict.label).toBe("unverified");
    expect(check.verdict.warnings).toContain("missing_registration_number");
  });

  test("registration lookup ignores case and spacing", async () => {
    const label = { ...(await extractLabel({ kind: "demo", id: "DEMO-0001" })), registrationNumber: " demo-0001 " };
    expect(runCheck(label, demoRecords, TODAY).verdict.label).toBe("record_match");
  });
});

describe("searchRecords", () => {
  test("empty query with All returns every record", () => {
    expect(searchRecords(demoRecords, "", "all")).toHaveLength(demoRecords.length);
  });

  test("matches registration number fragments", () => {
    expect(searchRecords(demoRecords, "demo-0002", "all").map((r) => r.registrationNumber)).toEqual(["DEMO-0002"]);
  });

  test("matches name and active ingredient case-insensitively", () => {
    expect(searchRecords(demoRecords, "testacillin", "all")).toHaveLength(1);
    expect(searchRecords(demoRecords, "PARACETAMOL", "all")[0]?.registrationNumber).toBe("DEMO-0001");
  });

  test("dosage filter groups tablet variants together", () => {
    const tablets = searchRecords(demoRecords, "", "tablets").map((r) => r.registrationNumber);
    expect(tablets).toEqual(["DEMO-0001", "DEMO-0004", "DEMO-0005", "DEMO-0006"]);
    expect(searchRecords(demoRecords, "", "capsules").map((r) => r.registrationNumber)).toEqual(["DEMO-0003"]);
    expect(searchRecords(demoRecords, "", "syrups").map((r) => r.registrationNumber)).toEqual(["DEMO-0002"]);
  });

  test("query and filter combine", () => {
    expect(searchRecords(demoRecords, "DEMO-0002", "tablets")).toHaveLength(0);
  });

  test("dosageGroup and initials", () => {
    expect(dosageGroup("Dispersible tablet")).toBe("tablets");
    expect(dosageGroup(null)).toBeNull();
    expect(initials("DemoCough Syrup")).toBe("DS");
  });
});

describe("alerts", () => {
  test("only reference fictional demo medicines", () => {
    for (const alert of SAMPLE_ALERTS) {
      const record = demoRecords.find((r) => r.registrationNumber === alert.registrationNumber);
      expect(record?.productName).toBe(alert.productName);
    }
  });

  test("filters by type", () => {
    expect(filterAlerts(SAMPLE_ALERTS, "all")).toHaveLength(SAMPLE_ALERTS.length);
    expect(filterAlerts(SAMPLE_ALERTS, "falsified").every((a) => a.type === "falsified")).toBe(true);
    expect(filterAlerts(SAMPLE_ALERTS, "recalled").every((a) => a.type === "recall")).toBe(true);
  });
});

describe("format", () => {
  test("formats dates and expiry", () => {
    expect(formatDate("2026-10-08")).toBe("8 Oct 2026");
    expect(formatExpiry("2027-08")).toBe("Aug 2027");
    expect(formatExpiry("[unreadable]")).toBe("[unreadable]");
  });
});

describe("json store", () => {
  const entry: HistoryEntry = {
    id: "1",
    checkedAt: "2026-10-31T10:00:00.000Z",
    productName: "SampleMed 500",
    registrationNumber: "DEMO-0001",
    label: "record_match",
    summary: "ok",
  };

  test("history round-trips through storage and keeps a stable snapshot", () => {
    const storage = fakeStorage();
    const store = createHistoryStore(() => storage);
    expect(store.getSnapshot()).toEqual([]);
    store.set(prependHistory(store.getSnapshot(), entry));
    expect(store.getSnapshot()).toEqual([entry]);
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  test("history is capped at 20 entries, newest first", () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 25; i++) list = prependHistory(list, { ...entry, id: String(i) });
    expect(list).toHaveLength(20);
    expect(list[0]?.id).toBe("24");
  });

  test("corrupt or wrongly shaped data falls back to empty", () => {
    const storage = fakeStorage();
    storage.data.set("nafdac-verify:history", "{not json");
    expect(createHistoryStore(() => storage).getSnapshot()).toEqual([]);
    storage.data.set("nafdac-verify:scan", JSON.stringify({ source: "demo" }));
    expect(createSessionStore(() => storage).getSnapshot()).toBeNull();
  });

  test("falls back to memory when storage throws on write", () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    };
    const store = createHistoryStore(() => broken);
    store.set([entry]);
    expect(store.getSnapshot()).toEqual([entry]);
  });

  test("notifies subscribers on set", () => {
    const store = createJsonStore<number>({
      key: "n",
      empty: 0,
      parse: (raw) => parseJson(raw, (v) => (typeof v === "number" ? v : null)),
      getStorage: () => fakeStorage(),
    });
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);
    store.set(2);
    unsubscribe();
    store.set(3);
    expect(calls).toBe(1);
  });
});
