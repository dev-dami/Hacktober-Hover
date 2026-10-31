import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LabelFields } from "./fields.ts";
import type { CheckResult } from "./match.ts";

export interface ScanRow {
  id: string;
  createdAt: string;
  /** unreviewed: model output only. reviewed: a person confirmed/corrected the fields (training label). */
  status: "unreviewed" | "reviewed";
  model: string | null;
  extracted: LabelFields | null;
  corrected: LabelFields | null;
  notes: string | null;
  originalFile: string;
  imageFile: string;
  width: number;
  height: number;
}

export type ReportStatus = "submitted" | "in_review" | "forwarded_to_nafdac" | "dismissed";

export interface ReportRow {
  id: string;
  receiptToken: string;
  createdAt: string;
  status: ReportStatus;
  scanId: string | null;
  fields: LabelFields;
  description: string;
  state: string;
  lga: string | null;
  purchasePlace: string | null;
  purchaseDate: string | null;
  contact: string | null;
  check: CheckResult;
  groupKey: string;
  photos: string[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scans (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unreviewed',
  model TEXT,
  extracted_json TEXT,
  corrected_json TEXT,
  notes TEXT,
  original_file TEXT NOT NULL,
  image_file TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  receipt_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  scan_id TEXT REFERENCES scans(id),
  fields_json TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL,
  lga TEXT,
  purchase_place TEXT,
  purchase_date TEXT,
  contact TEXT,
  check_json TEXT NOT NULL,
  group_key TEXT NOT NULL,
  photos_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS reports_group ON reports(group_key);
`;

const json = <T>(v: string | null): T | null => (v ? (JSON.parse(v) as T) : null);

export function openDb(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { strict: true, create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const toScan = (r: Record<string, any>): ScanRow => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    model: r.model,
    extracted: json(r.extracted_json),
    corrected: json(r.corrected_json),
    notes: r.notes,
    originalFile: r.original_file,
    imageFile: r.image_file,
    width: r.width,
    height: r.height,
  });
  const toReport = (r: Record<string, any>): ReportRow => ({
    id: r.id,
    receiptToken: r.receipt_token,
    createdAt: r.created_at,
    status: r.status,
    scanId: r.scan_id,
    fields: JSON.parse(r.fields_json),
    description: r.description,
    state: r.state,
    lga: r.lga,
    purchasePlace: r.purchase_place,
    purchaseDate: r.purchase_date,
    contact: r.contact,
    check: JSON.parse(r.check_json),
    groupKey: r.group_key,
    photos: JSON.parse(r.photos_json),
  });

  return {
    raw: db,
    insertScan(s: ScanRow) {
      db.query(
        `INSERT INTO scans (id, created_at, status, model, extracted_json, corrected_json, notes, original_file, image_file, width, height)
         VALUES ($id, $createdAt, $status, $model, $extracted, $corrected, $notes, $originalFile, $imageFile, $width, $height)`,
      ).run({
        ...s,
        extracted: s.extracted && JSON.stringify(s.extracted),
        corrected: s.corrected && JSON.stringify(s.corrected),
      });
    },
    getScan(id: string): ScanRow | null {
      const row = db.query("SELECT * FROM scans WHERE id = $id").get({ id });
      return row ? toScan(row as Record<string, any>) : null;
    },
    reviewScan(id: string, corrected: LabelFields) {
      db.query("UPDATE scans SET corrected_json = $corrected, status = 'reviewed' WHERE id = $id").run({
        id,
        corrected: JSON.stringify(corrected),
      });
    },
    insertReport(r: ReportRow) {
      db.query(
        `INSERT INTO reports (id, receipt_token, created_at, status, scan_id, fields_json, description, state, lga,
           purchase_place, purchase_date, contact, check_json, group_key, photos_json)
         VALUES ($id, $receiptToken, $createdAt, $status, $scanId, $fields, $description, $state, $lga,
           $purchasePlace, $purchaseDate, $contact, $check, $groupKey, $photos)`,
      ).run({
        ...r,
        fields: JSON.stringify(r.fields),
        check: JSON.stringify(r.check),
        photos: JSON.stringify(r.photos),
      });
    },
    getReport(id: string): ReportRow | null {
      const row = db.query("SELECT * FROM reports WHERE id = $id").get({ id });
      return row ? toReport(row as Record<string, any>) : null;
    },
    listReports(): ReportRow[] {
      return (db.query("SELECT * FROM reports ORDER BY created_at DESC").all() as Record<string, any>[]).map(toReport);
    },
    setReportStatus(id: string, status: ReportStatus) {
      return db.query("UPDATE reports SET status = $status WHERE id = $id").run({ id, status }).changes > 0;
    },
    counts() {
      const one = (sql: string) => (db.query(sql).get() as { n: number }).n;
      return {
        scans: one("SELECT COUNT(*) AS n FROM scans"),
        reviewedScans: one("SELECT COUNT(*) AS n FROM scans WHERE status = 'reviewed'"),
        reports: one("SELECT COUNT(*) AS n FROM reports"),
      };
    },
  };
}

export type Db = ReturnType<typeof openDb>;
