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
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  scan_id TEXT NOT NULL REFERENCES scans(id),
  kind TEXT NOT NULL,              -- verify | closeup
  started_at TEXT NOT NULL,
  ms INTEGER NOT NULL,
  status TEXT NOT NULL,            -- verified | needs_review | needs_photo | failed
  summary_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_runs_scan ON agent_runs(scan_id);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,            -- user | reviewer
  kind TEXT NOT NULL,              -- alert_relevance | explanation_rating | alert_verdict
  scan_id TEXT,
  report_id TEXT,
  alert_id INTEGER,
  match_strength TEXT,
  value TEXT NOT NULL,
  comment TEXT
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,            -- draft | approved | sent
  markdown TEXT NOT NULL,
  model TEXT,
  report_ids_json TEXT NOT NULL,
  sent_note TEXT
);
CREATE INDEX IF NOT EXISTS submissions_group ON submissions(group_key);
`;

export interface AgentRunRow {
  id: string;
  scanId: string;
  kind: "verify" | "closeup";
  startedAt: string;
  ms: number;
  status: string;
  summary: import("./agent.ts").RunSummary;
}

export interface FeedbackRow {
  id: string;
  createdAt: string;
  source: "user" | "reviewer";
  kind: "alert_relevance" | "explanation_rating" | "alert_verdict";
  scanId: string | null;
  reportId: string | null;
  alertId: number | null;
  matchStrength: string | null;
  value: string;
  comment: string | null;
}

export interface SubmissionRow {
  id: string;
  groupKey: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "approved" | "sent";
  markdown: string;
  model: string | null;
  reportIds: string[];
  sentNote: string | null;
}

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

  const toRun = (r: Record<string, any>): AgentRunRow => ({
    id: r.id,
    scanId: r.scan_id,
    kind: r.kind,
    startedAt: r.started_at,
    ms: r.ms,
    status: r.status,
    summary: JSON.parse(r.summary_json),
  });
  const toSubmission = (r: Record<string, any>): SubmissionRow => ({
    id: r.id,
    groupKey: r.group_key,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    status: r.status,
    markdown: r.markdown,
    model: r.model,
    reportIds: JSON.parse(r.report_ids_json),
    sentNote: r.sent_note,
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
    listScans(): ScanRow[] {
      return (db.query("SELECT * FROM scans ORDER BY created_at DESC").all() as Record<string, any>[]).map(toScan);
    },
    /** Store the agent's merged reading as the scan's model output. */
    setScanExtraction(id: string, fields: LabelFields, model: string, notes: string | null) {
      db.query("UPDATE scans SET extracted_json = $fields, model = $model, notes = $notes WHERE id = $id").run({
        id,
        fields: JSON.stringify(fields),
        model,
        notes,
      });
    },

    insertRun(run: AgentRunRow) {
      db.query(
        `INSERT INTO agent_runs (id, scan_id, kind, started_at, ms, status, summary_json)
         VALUES ($id, $scanId, $kind, $startedAt, $ms, $status, $summary)`,
      ).run({ ...run, summary: JSON.stringify(run.summary) });
    },
    latestRun(scanId: string): AgentRunRow | null {
      const row = db
        .query("SELECT * FROM agent_runs WHERE scan_id = $scanId ORDER BY started_at DESC LIMIT 1")
        .get({ scanId }) as Record<string, any> | null;
      return row ? toRun(row) : null;
    },
    listRuns(): AgentRunRow[] {
      return (db.query("SELECT * FROM agent_runs ORDER BY started_at DESC").all() as Record<string, any>[]).map(toRun);
    },

    insertFeedback(f: FeedbackRow) {
      db.query(
        `INSERT INTO feedback (id, created_at, source, kind, scan_id, report_id, alert_id, match_strength, value, comment)
         VALUES ($id, $createdAt, $source, $kind, $scanId, $reportId, $alertId, $matchStrength, $value, $comment)`,
      ).run({ ...f });
    },
    listFeedback(): FeedbackRow[] {
      return (db.query("SELECT * FROM feedback ORDER BY created_at DESC").all() as Record<string, any>[]).map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        source: r.source,
        kind: r.kind,
        scanId: r.scan_id,
        reportId: r.report_id,
        alertId: r.alert_id,
        matchStrength: r.match_strength,
        value: r.value,
        comment: r.comment,
      }));
    },

    insertSubmission(s: SubmissionRow) {
      db.query(
        `INSERT INTO submissions (id, group_key, created_at, updated_at, status, markdown, model, report_ids_json, sent_note)
         VALUES ($id, $groupKey, $createdAt, $updatedAt, $status, $markdown, $model, $reportIds, $sentNote)`,
      ).run({ ...s, reportIds: JSON.stringify(s.reportIds) });
    },
    updateSubmission(id: string, patch: Partial<Pick<SubmissionRow, "status" | "markdown" | "sentNote" | "updatedAt">>) {
      const current = this.getSubmission(id);
      if (!current) return null;
      const next = { ...current, ...patch };
      db.query(
        "UPDATE submissions SET status = $status, markdown = $markdown, sent_note = $sentNote, updated_at = $updatedAt WHERE id = $id",
      ).run({ id, status: next.status, markdown: next.markdown, sentNote: next.sentNote, updatedAt: next.updatedAt });
      return next;
    },
    getSubmission(id: string): SubmissionRow | null {
      const row = db.query("SELECT * FROM submissions WHERE id = $id").get({ id }) as Record<string, any> | null;
      return row ? toSubmission(row) : null;
    },
    listSubmissions(groupKey?: string): SubmissionRow[] {
      const rows = groupKey
        ? db.query("SELECT * FROM submissions WHERE group_key = $groupKey ORDER BY created_at DESC").all({ groupKey })
        : db.query("SELECT * FROM submissions ORDER BY created_at DESC").all();
      return (rows as Record<string, any>[]).map(toSubmission);
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
