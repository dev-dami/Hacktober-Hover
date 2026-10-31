import { describe, expect, test } from "bun:test";
import type { AlertMatch, CheckResult } from "./api";
import { formatDate, formatExpiry } from "./format";
import { createJsonStore, parseJson, type KeyValueStorage } from "./json-store";
import { createHistoryStore, createSessionStore, prependHistory, type HistoryEntry } from "./stores";
import { verdictOf } from "./verdict";

function fakeStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("verdictOf", () => {
  const alert = (strength: AlertMatch["strength"]) => ({ alertId: 1, strength }) as AlertMatch;
  const check = (status: CheckResult["registry"]["status"], alerts: AlertMatch[] = []) =>
    ({ registry: { status, registrationNumber: null, records: [], note: "" }, alerts, summary: "" }) as CheckResult;

  test("a strong alert match outranks every register result", () => {
    expect(verdictOf(check("registered", [alert("strong")]))).toBe("alert");
    expect(verdictOf(check("registered_details_differ", [alert("strong")]))).toBe("alert");
  });

  test("differing details outrank a possible alert", () => {
    expect(verdictOf(check("registered_details_differ", [alert("possible")]))).toBe("mismatch");
    expect(verdictOf(check("registered", [alert("possible")]))).toBe("possible_alert");
  });

  test("register results without alerts", () => {
    expect(verdictOf(check("registered"))).toBe("match");
    expect(verdictOf(check("not_in_greenbook"))).toBe("not_found");
    expect(verdictOf(check("not_provided"))).toBe("unverified");
    expect(verdictOf(check("registered_ambiguous"))).toBe("unverified");
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
    verdict: "match",
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
