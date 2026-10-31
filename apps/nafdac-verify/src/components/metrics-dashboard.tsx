"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { AlertOctagon, ArrowLeft, Camera, CheckCircle2, Eye, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, FIELD_LABELS, type FieldName } from "@/lib/api";
import { useReviewToken } from "@/lib/review-token";

// Chart roles (reference palette: series slot 1 + fixed status colors; validated on the light surface).
const VIZ_VARS = {
  "--series-1": "#2a78d6",
  "--status-good": "#0ca30c",
  "--status-warning": "#fab219",
  "--status-serious": "#ec835a",
  "--status-critical": "#d03b3b",
  "--track": "#ecebe8",
} as CSSProperties;

type Precision = { n: number; precision: number | null };
interface EvalSummary {
  strategy: string;
  runs: number;
  failed: number;
  p50Ms: number | null;
  p90Ms: number | null;
  avgCalls: number | null;
  batch: { cases: number; hit: number; wrong: number; notVisible: number };
  registration: { cases: number; hit: number; wrong: number; notVisible: number };
  verified?: number;
  verifiedButWrong?: number;
}
interface Metrics {
  generatedAt: string;
  data: { alerts: number; registeredProducts: number };
  usage: {
    scans: number;
    reviewedScans: number;
    reports: number;
    scansPerDay: { date: string; count: number }[];
    reportsPerDay: { date: string; count: number }[];
  };
  agent: {
    runs: number;
    statuses: Record<string, number>;
    latencyMs: { p50: number | null; p90: number | null };
    avgModelCalls: number | null;
    escalations: Record<string, number>;
    modelCallFailureRate: number | null;
    callsByTask: Record<string, { n: number; p50Ms: number | null }>;
  };
  reader: {
    fieldAccuracy: Record<FieldName, { compared: number; accuracy: number | null }>;
    offlineEval: { ranAt: string; model: string; cases: number; note: string; summary: EvalSummary[] } | null;
  };
  checks: { outcomes: Record<string, number>; registry: Record<string, number> };
  feedback: {
    userAlertRelevance: Record<"strong" | "possible", Precision>;
    reviewerAlertVerdicts: Record<"strong" | "possible", Precision>;
    explanationHelpful: { n: number; rate: number | null };
  };
  reports: {
    statuses: Record<string, number>;
    byState: Record<string, number>;
    groups: number;
    groupsWithMultipleReports: number;
    submissions: Record<string, number>;
  };
}

const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const pct = (v: number | null) => (v === null ? "–" : `${v}%`);

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function StatTile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Horizontal bars for category counts: one hue, sorted, value labelled at the bar end. */
function BarList({ data, label = (k: string) => k, empty = "No data yet." }: { data: Record<string, number>; label?: (k: string) => string; empty?: string }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map(([, n]) => n));
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {rows.map(([key, n]) => (
        <li key={key} className="grid grid-cols-[minmax(6rem,10rem)_1fr_2.5rem] items-center gap-2" title={`${label(key)}: ${n}`}>
          <span className="truncate text-muted-foreground">{label(key)}</span>
          <span className="h-3 rounded-r-[4px]" style={{ width: `${(n / max) * 100}%`, minWidth: 3, background: "var(--series-1)" }} />
          <span className="text-right tabular-nums">{n}</span>
        </li>
      ))}
    </ul>
  );
}

/** Daily counts as thin columns with a hover tooltip. Single series: the title names it, no legend. */
function DailyColumns({ title, data }: { title: string; data: { date: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const total = data.reduce((n, d) => n + d.count, 0);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex justify-between text-sm">
        <span>{title}</span>
        <span className="tabular-nums text-muted-foreground">{total} in 14 days</span>
      </figcaption>
      <div className="flex h-24 items-end gap-[2px] border-b" role="img" aria-label={`${title}: ${data.map((d) => `${d.date} ${d.count}`).join(", ")}`}>
        {data.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 items-end justify-center">
            <div
              className="w-full max-w-4 rounded-t-[4px]"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count ? 2 : 0, background: "var(--series-1)" }}
            />
            <span className="pointer-events-none absolute -top-7 z-10 hidden whitespace-nowrap rounded-md border bg-background px-1.5 py-0.5 text-xs shadow-sm group-hover:block">
              {d.date.slice(5)}: {d.count}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data.at(-1)?.date.slice(5)}</span>
      </div>
    </figure>
  );
}

const RUN_STATUS: Record<string, { label: string; color: string; Icon: typeof CheckCircle2 }> = {
  verified: { label: "Verified", color: "var(--status-good)", Icon: CheckCircle2 },
  needs_review: { label: "Needs review", color: "var(--status-warning)", Icon: Eye },
  needs_photo: { label: "Asked for close-up", color: "var(--status-serious)", Icon: Camera },
  failed: { label: "Failed", color: "var(--status-critical)", Icon: AlertOctagon },
};

/** Agent outcomes: status colour always paired with icon + label. */
function StatusBars({ data }: { data: Record<string, number> }) {
  const total = Object.values(data).reduce((a, b) => a + b, 0);
  if (!total) return <p className="text-sm text-muted-foreground">No agent runs yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {Object.keys(RUN_STATUS).map((key) => {
        const n = data[key] ?? 0;
        const { label, color, Icon } = RUN_STATUS[key]!;
        return (
          <li key={key} className="grid grid-cols-[minmax(8rem,11rem)_1fr_4.5rem] items-center gap-2" title={`${label}: ${n}`}>
            <span className="flex items-center gap-1.5">
              <Icon className="size-4 shrink-0" style={{ color }} aria-hidden /> {label}
            </span>
            <span className="h-3 rounded-[4px]" style={{ background: "var(--track)" }}>
              <span className="block h-3 rounded-[4px]" style={{ width: `${(n / total) * 100}%`, background: color }} />
            </span>
            <span className="text-right tabular-nums">
              {n} <span className="text-muted-foreground">({Math.round((n / total) * 100)}%)</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** A single ratio against 100%. */
function Meter({ label, value, n }: { label: string; value: number | null; n: number }) {
  return (
    <div className="flex flex-col gap-1 text-sm" title={`${label}: ${pct(value)} of ${n}`}>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums">
          {pct(value)} <span className="text-xs text-muted-foreground">n={n}</span>
        </span>
      </div>
      <div className="h-2 rounded-[4px]" style={{ background: "var(--track)" }}>
        <div className="h-2 rounded-[4px]" style={{ width: `${value ?? 0}%`, background: "var(--series-1)" }} />
      </div>
    </div>
  );
}

function EvalTable({ evalRun }: { evalRun: NonNullable<Metrics["reader"]["offlineEval"]> }) {
  const cell = (f: EvalSummary["batch"]) =>
    f.cases ? (
      <>
        {f.hit}/{f.cases}
        {f.wrong > 0 && <span className="ml-1 font-medium" style={{ color: "var(--status-critical)" }}>({f.wrong} wrong)</span>}
      </>
    ) : (
      "–"
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-normal">Strategy</th>
            <th className="py-1 pr-3 font-normal">Batch read right</th>
            <th className="py-1 pr-3 font-normal">Reg. no. read right</th>
            <th className="py-1 pr-3 font-normal">Median time</th>
            <th className="py-1 pr-3 font-normal">90th pct time</th>
            <th className="py-1 pr-3 font-normal">AI calls</th>
            <th className="py-1 font-normal">Verified but wrong</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {evalRun.summary.map((s) => (
            <tr key={s.strategy} className="border-t">
              <td className="py-1.5 pr-3 font-medium capitalize">{s.strategy === "agent" ? "Agent loop" : `${s.strategy} read`}</td>
              <td className="py-1.5 pr-3">{cell(s.batch)}</td>
              <td className="py-1.5 pr-3">{cell(s.registration)}</td>
              <td className="py-1.5 pr-3">{seconds(s.p50Ms)}</td>
              <td className="py-1.5 pr-3">{seconds(s.p90Ms)}</td>
              <td className="py-1.5 pr-3">{s.avgCalls ?? "–"}</td>
              <td className="py-1.5">{s.verifiedButWrong === undefined ? "n/a" : `${s.verifiedButWrong} of ${s.verified} verified`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">
        {evalRun.cases} real NAFDAC alert photos, {evalRun.model}, {new Date(evalRun.ranAt).toLocaleString("en-NG")}. {evalRun.note}
      </p>
    </div>
  );
}

const LABELS: Record<string, string> = {
  strong_match: "Close alert match",
  possible_match: "Possible alert match",
  no_match: "No alert match",
  registered: "Registered, details agree",
  registered_details_differ: "Registered to other product",
  registered_ambiguous: "Number on several products",
  not_in_greenbook: "Not in Greenbook",
  not_provided: "No number read",
  reread: "Re-read a field",
  search: "Searched other names",
  one_reading_failed: "One reading failed",
  closeup: "Close-up photo",
};
const nice = (k: string) => LABELS[k] ?? k.replaceAll("_", " ");

export function MetricsDashboard() {
  const { token } = useReviewToken();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    api<Metrics>("/api/review/metrics", { headers: { Authorization: `Bearer ${token}` } }).then(setMetrics, (e) =>
      setError(e instanceof ApiError ? e.message : "Failed to load metrics"),
    );
  }, [token]);

  if (!token) {
    return (
      <p className="text-sm">
        <Link href="/reviewer" className="underline">
          Sign in as a reviewer
        </Link>{" "}
        to see metrics.
      </p>
    );
  }
  if (error) return <p className="text-destructive">{error}</p>;
  if (!metrics) return <Loader2 className="animate-spin" />;

  const m = metrics;
  const fieldRows = (Object.keys(FIELD_LABELS) as FieldName[]).map((f) => ({ f, ...m.reader.fieldAccuracy[f] }));

  return (
    <div className="flex flex-col gap-4" style={VIZ_VARS}>
      <div>
        <Link href="/reviewer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" /> Incident groups
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Metrics</h1>
        <p className="text-sm text-muted-foreground">
          {m.data.alerts} NAFDAC alerts · {m.data.registeredProducts.toLocaleString()} registered products · updated{" "}
          {new Date(m.generatedAt).toLocaleTimeString("en-NG")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Scans" value={m.usage.scans} sub={`${m.usage.reviewedScans} confirmed by people`} />
        <StatTile label="Reports" value={m.usage.reports} sub={`${m.reports.groups} incident groups`} />
        <StatTile label="Groups with 2+ reports" value={m.reports.groupsWithMultipleReports} />
        <StatTile label="Sent to NAFDAC" value={m.reports.submissions.sent ?? 0} sub={`${m.reports.submissions.approved ?? 0} approved, ${m.reports.submissions.draft ?? 0} draft`} />
      </div>

      <Section title="Activity">
        <div className="grid gap-6 sm:grid-cols-2">
          <DailyColumns title="Scans per day" data={m.usage.scansPerDay} />
          <DailyColumns title="Reports per day" data={m.usage.reportsPerDay} />
        </div>
      </Section>

      <Section title="Verification agent" description="How sure the agent got, and what it cost.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Runs" value={m.agent.runs} />
          <StatTile label="Median time" value={seconds(m.agent.latencyMs.p50)} sub={`90th pct ${seconds(m.agent.latencyMs.p90)}`} />
          <StatTile label="AI calls per run" value={m.agent.avgModelCalls ?? "–"} />
          <StatTile label="AI call failures" value={pct(m.agent.modelCallFailureRate)} sub="after retries" />
        </div>
        <StatusBars data={m.agent.statuses} />
        <div>
          <p className="mb-2 text-sm font-medium">Extra work the agent did</p>
          <BarList data={m.agent.escalations} label={nice} empty="No escalations yet." />
        </div>
      </Section>

      <Section
        title="Speed vs certainty"
        description="Offline test on real NAFDAC alert photos. Run `bun run eval:reader` to refresh."
      >
        {m.reader.offlineEval ? <EvalTable evalRun={m.reader.offlineEval} /> : <p className="text-sm text-muted-foreground">No offline evaluation yet.</p>}
      </Section>

      <Section title="Reader accuracy" description="Model readings kept unchanged when people confirmed the details.">
        <div className="grid gap-3 sm:grid-cols-2">
          {fieldRows.map((r) => (
            <Meter key={r.f} label={FIELD_LABELS[r.f]} value={r.accuracy} n={r.compared} />
          ))}
        </div>
      </Section>

      <Section title="Match quality" description="Share of matched alerts judged to be about the scanned product.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Meter label="Close matches, reviewers" value={m.feedback.reviewerAlertVerdicts.strong.precision} n={m.feedback.reviewerAlertVerdicts.strong.n} />
          <Meter label="Possible matches, reviewers" value={m.feedback.reviewerAlertVerdicts.possible.precision} n={m.feedback.reviewerAlertVerdicts.possible.n} />
          <Meter label="Close matches, users" value={m.feedback.userAlertRelevance.strong.precision} n={m.feedback.userAlertRelevance.strong.n} />
          <Meter label="Possible matches, users" value={m.feedback.userAlertRelevance.possible.precision} n={m.feedback.userAlertRelevance.possible.n} />
          <Meter label="Explanations rated helpful" value={m.feedback.explanationHelpful.rate} n={m.feedback.explanationHelpful.n} />
        </div>
      </Section>

      <Section title="Check outcomes">
        <div className="grid gap-6 sm:grid-cols-2">
          <BarList data={m.checks.outcomes} label={nice} />
          <BarList data={m.checks.registry} label={nice} />
        </div>
      </Section>

      <Section title="Reports">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium">By state</p>
            <BarList data={m.reports.byState} empty="No reports yet." />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">By status</p>
            <BarList data={m.reports.statuses} label={nice} empty="No reports yet." />
          </div>
        </div>
      </Section>
    </div>
  );
}
