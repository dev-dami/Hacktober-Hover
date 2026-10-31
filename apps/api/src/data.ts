// In-memory indexes over the downloaded NAFDAC datasets (loaded once at startup).

import { resolve } from "node:path";
import type { Alert } from "../../../scripts/nafdac-alerts/reader.ts";
import type { ProductRecord } from "@hacktober/verify-core";
import { normalizeBatch, regKey, tokens } from "./fields.ts";

export type { Alert, ProductRecord };

export interface IndexedAlert {
  alert: Alert;
  /** Normalized batch numbers listed in the alert's tables. */
  batches: Set<string>;
  /** Normalized registration numbers mentioned near "NAFDAC"/"NRN". */
  registrationNumbers: Map<string, { flaggedFake: boolean; context: string }>;
  /** Tokens of the product names and title (what the alert is about). */
  nameTokens: Set<string>;
  manufacturerTokens: Set<string>;
  /** Uppercased alphanumeric runs of the full text, for batch numbers that only appear in prose. */
  textTokens: Set<string>;
  searchText: string;
}

export interface Datasets {
  alerts: IndexedAlert[];
  alertsById: Map<number, IndexedAlert>;
  /** Greenbook records by normalized registration number (a number can map to several products). */
  registry: Map<string, ProductRecord[]>;
  registryCount: number;
}

export function indexAlert(alert: Alert): IndexedAlert {
  return {
    alert,
    batches: new Set(alert.batchNumbers.map(normalizeBatch).filter((b) => b.length >= 3)),
    registrationNumbers: new Map(
      alert.registrationNumbers.map((r) => [regKey(r.number), { flaggedFake: r.flaggedFake, context: r.context }]),
    ),
    nameTokens: new Set([...alert.productNames.flatMap((n) => tokens(n)), ...tokens(alert.title)]),
    manufacturerTokens: new Set(alert.manufacturers.flatMap((m) => tokens(m))),
    textTokens: new Set(alert.text.toUpperCase().match(/[A-Z0-9]{3,}/g) ?? []),
    searchText: [alert.title, ...alert.productNames, ...alert.manufacturers, ...alert.batchNumbers, alert.text]
      .join(" ")
      .toLowerCase(),
  };
}

export function buildDatasets(alerts: Alert[], products: ProductRecord[]): Datasets {
  const indexed = alerts.map(indexAlert);
  const registry = new Map<string, ProductRecord[]>();
  for (const product of products) {
    const key = regKey(product.registrationNumber);
    registry.set(key, [...(registry.get(key) ?? []), product]);
  }
  return {
    alerts: indexed,
    alertsById: new Map(indexed.map((a) => [a.alert.id, a])),
    registry,
    registryCount: products.length,
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.warn(`[data] ${path} not found; run the data scripts (see data/README.md)`);
    return fallback;
  }
  return (await file.json()) as T;
}

export async function loadDatasets(dataDir: string): Promise<Datasets> {
  const [alerts, products] = await Promise.all([
    readJson<Alert[]>(resolve(dataDir, "raw/public-alerts.json"), []),
    readJson<ProductRecord[]>(resolve(dataDir, "processed/normalized-products.json"), []),
  ]);
  const datasets = buildDatasets(alerts, products);
  console.log(`[data] ${datasets.alerts.length} alerts, ${datasets.registryCount} registered products`);
  return datasets;
}
