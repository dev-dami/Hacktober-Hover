"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BarChart3, Check, Download, ExternalLink, FileText, Loader2, LogOut, Send, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, API_URL, formatDate, type AlertMatch, type LabelFields } from "@/lib/api";
import { useReviewToken } from "@/lib/review-token";

interface Submission {
  id: string;
  groupKey: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "approved" | "sent";
  markdown: string;
  model: string | null;
  sentNote: string | null;
}

interface Group {
  key: string;
  productName: string | null;
  batchNumber: string | null;
  reportCount: number;
  states: string[];
  lastReportedAt: string;
  matchingAlerts: { id: number; title: string; url: string; strength: string }[];
  statuses: Record<string, number>;
  reportIds: string[];
  submission: Submission | null;
}

interface FullReport {
  id: string;
  createdAt: string;
  status: string;
  fields: LabelFields;
  description: string;
  state: string;
  lga: string | null;
  purchasePlace: string | null;
  contact: string | null;
  photos: string[];
  check: { alerts: AlertMatch[] };
  verdicts: { alertId: number; value: string }[];
  evidence: { markdown: string };
}

const STATUSES = ["submitted", "in_review", "forwarded_to_nafdac", "dismissed"] as const;

function useAuthedApi(token: string) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: <T,>(path: string) => api<T>(path, { headers }),
    send: <T,>(method: string, path: string, body?: unknown) =>
      api<T>(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  };
}

function ReportDetail({ id, token, onChanged }: { id: string; token: string; onChanged: () => void }) {
  const http = useAuthedApi(token);
  const [report, setReport] = useState<FullReport | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);

  useEffect(() => {
    let urls: string[] = [];
    let cancelled = false;
    http.get<FullReport>(`/api/review/reports/${id}`).then(async (r) => {
      if (cancelled) return;
      setReport(r);
      // Photos need the bearer token, so fetch them as blobs instead of plain <img src>.
      urls = await Promise.all(
        r.photos.map(async (name) => {
          const res = await fetch(`${API_URL}/api/review/reports/${id}/photos/${name}`, { headers: { Authorization: `Bearer ${token}` } });
          return URL.createObjectURL(await res.blob());
        }),
      );
      if (!cancelled) setPhotoUrls(urls);
    });
    return () => {
      cancelled = true;
      urls.forEach(URL.revokeObjectURL);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the report changes
  }, [id, token]);

  async function setStatus(status: string) {
    await http.send("PATCH", `/api/review/reports/${id}`, { status });
    setReport((r) => (r ? { ...r, status } : r));
    onChanged();
  }

  async function verdict(alertId: number, value: "confirmed" | "rejected") {
    await http.send("POST", `/api/review/reports/${id}/alerts/${alertId}/verdict`, { value });
    setReport((r) => (r ? { ...r, verdicts: [...r.verdicts, { alertId, value }] } : r));
  }

  if (!report) return <Loader2 className="animate-spin" />;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {formatDate(report.createdAt)} · {report.state}
          {report.lga ? `, ${report.lga}` : ""}
        </span>
        <select value={report.status} onChange={(e) => setStatus(e.target.value)} className="h-7 rounded-md border px-2 text-xs" aria-label="Report status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      <p>{report.description}</p>
      {report.purchasePlace && <p className="text-muted-foreground">Bought at: {report.purchasePlace}</p>}
      {report.contact && <p className="text-muted-foreground">Contact: {report.contact}</p>}
      {photoUrls.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {photoUrls.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URLs
            <img key={url} src={url} alt="Reported product" className="h-28 rounded-md border object-cover" />
          ))}
        </div>
      )}
      {report.check.alerts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Is each matched alert about this product?</p>
          {report.check.alerts.map((a) => {
            const given = report.verdicts.findLast((v) => v.alertId === a.alertId)?.value;
            return (
              <div key={a.alertId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2">
                <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">
                  {a.title}
                </a>
                {given ? (
                  <Badge variant={given === "confirmed" ? "secondary" : "outline"}>{given === "confirmed" ? "Confirmed" : "Rejected"}</Badge>
                ) : (
                  <span className="flex gap-1">
                    <Button size="xs" variant="outline" onClick={() => verdict(a.alertId, "confirmed")}>
                      <Check /> Relevant
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => verdict(a.alertId, "rejected")}>
                      <X /> Not relevant
                    </Button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">Evidence pack</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{report.evidence.markdown}</pre>
      </details>
    </div>
  );
}

function SubmissionPanel({ group, token, onChanged }: { group: Group; token: string; onChanged: () => void }) {
  const http = useAuthedApi(token);
  const [submission, setSubmission] = useState<Submission | null>(group.submission);
  const [text, setText] = useState(group.submission?.markdown ?? "");
  const [sentNote, setSentNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(fn: () => Promise<Submission>) {
    setBusy(true);
    setError(null);
    try {
      const s = await fn();
      setSubmission(s);
      setText(s.markdown);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Action failed");
    }
    setBusy(false);
  }

  const draft = () => act(() => http.send<Submission>("POST", `/api/review/groups/${encodeURIComponent(group.key)}/submission`));
  const patch = (body: Record<string, unknown>) => act(() => http.send<Submission>("PATCH", `/api/review/submissions/${submission!.id}`, body));

  async function download() {
    const res = await fetch(`${API_URL}/api/review/submissions/${submission!.id}/export`, { headers: { Authorization: `Bearer ${token}` } });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await res.blob());
    link.download = `nafdac-submission-${submission!.id.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (!submission) {
    return (
      <Button variant="outline" size="sm" className="w-fit" onClick={draft} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" /> : <FileText />} Draft NAFDAC submission
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={submission.status === "sent" ? "secondary" : "outline"}>Submission: {submission.status}</Badge>
        <span className="text-muted-foreground">
          {submission.model ? `Drafted by ${submission.model}` : "Template draft"} · updated {formatDate(submission.updatedAt)}
        </span>
        {submission.sentNote && <span className="text-muted-foreground">· {submission.sentNote}</span>}
      </div>
      {submission.status === "draft" ? (
        <Textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="font-mono text-xs" aria-label="Submission text" />
      ) : (
        <pre className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{submission.markdown}</pre>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {submission.status === "draft" && (
          <>
            <Button size="sm" variant="outline" disabled={busy || text === submission.markdown} onClick={() => patch({ markdown: text })}>
              Save edits
            </Button>
            <Button size="sm" disabled={busy || text !== submission.markdown} onClick={() => patch({ status: "approved" })}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={draft}>
              Redraft
            </Button>
          </>
        )}
        {submission.status === "approved" && (
          <>
            <Button size="sm" variant="outline" onClick={download}>
              <Download /> Download
            </Button>
            <Input
              value={sentNote}
              onChange={(e) => setSentNote(e.target.value)}
              placeholder="How it was sent, e.g. Med Safety app ref"
              className="h-7 w-64 text-xs"
            />
            <Button size="sm" disabled={busy} onClick={() => patch({ status: "sent", sentNote: sentNote || "Sent" })}>
              <Send /> Mark sent to NAFDAC
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: "draft" })}>
              Back to draft
            </Button>
          </>
        )}
        {submission.status === "sent" && (
          <Button size="sm" variant="outline" onClick={download}>
            <Download /> Download
          </Button>
        )}
      </div>
    </div>
  );
}

export function ReviewDashboard() {
  const { token, signIn, signOut } = useReviewToken();
  const [draftToken, setDraftToken] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh((n) => n + 1);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api<{ groups: Group[] }>("/api/review/groups", { headers: { Authorization: `Bearer ${token}` } }).then(
      (r) => {
        if (cancelled) return;
        setGroups(r.groups);
        setError(null);
      },
      (e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : "Failed to load");
        if (e instanceof ApiError && e.status === 401) signOut();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, refresh, signOut]);

  function onSignIn(event: FormEvent) {
    event.preventDefault();
    signIn(draftToken);
  }

  if (!token) {
    return (
      <form onSubmit={onSignIn} className="mx-auto flex max-w-sm flex-col gap-3">
        <h1 className="text-xl font-semibold">Reviewer access</h1>
        <p className="text-sm text-muted-foreground">Enter the reviewer token (ADMIN_TOKEN on the API server).</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} autoComplete="off" aria-label="Reviewer token" />
        <Button type="submit" disabled={!draftToken}>
          Continue
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incident groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reports about the same product and batch. Grouping is for review only and is not a finding that a product
            is counterfeit.
          </p>
        </div>
        <div className="flex gap-1">
          <Link href="/reviewer/metrics" className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[0.8rem] hover:bg-muted">
            <BarChart3 className="size-3.5" /> Metrics
          </Link>
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {!groups && !error && <Loader2 className="animate-spin" />}
      {groups?.length === 0 && <p className="text-muted-foreground">No reports yet.</p>}
      {groups?.map((group) => (
        <Card key={group.key} size="sm">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{group.productName ?? "Unknown product"}</CardTitle>
              <Badge variant={group.reportCount > 1 ? "destructive" : "secondary"}>
                {group.reportCount} report{group.reportCount > 1 ? "s" : ""}
              </Badge>
            </div>
            <CardDescription>
              Batch <span className="font-mono">{group.batchNumber ?? "not recorded"}</span> · {group.states.join(", ")} · last{" "}
              {formatDate(group.lastReportedAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {group.matchingAlerts.map((alert) => (
              <a key={alert.id} href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue hover:underline">
                {alert.title} <ExternalLink className="size-3 shrink-0" />
              </a>
            ))}
            <p className="text-xs text-muted-foreground">
              {Object.entries(group.statuses)
                .map(([s, n]) => `${n} ${s.replaceAll("_", " ")}`)
                .join(" · ")}
            </p>
            <SubmissionPanel key={group.submission?.id ?? "none"} group={group} token={token} onChanged={reload} />
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(open === group.key ? null : group.key)}>
              {open === group.key ? "Hide reports" : "Show reports"}
            </Button>
            {open === group.key && group.reportIds.map((id) => <ReportDetail key={id} id={id} token={token} onChanged={reload} />)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
