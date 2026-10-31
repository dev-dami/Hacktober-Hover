"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Loader2, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError, API_URL, formatDate, type LabelFields } from "@/lib/api";
import { useClientValue } from "@/lib/use-client-value";

interface Group {
  key: string;
  productName: string | null;
  batchNumber: string | null;
  reportCount: number;
  states: string[];
  firstReportedAt: string;
  lastReportedAt: string;
  matchingAlerts: { id: number; title: string; url: string }[];
  statuses: Record<string, number>;
  reportIds: string[];
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
  evidence: { markdown: string };
}

const TOKEN_KEY = "safemeds:review-token";
const STATUSES = ["submitted", "in_review", "forwarded_to_nafdac", "dismissed"] as const;

function ReportDetail({ id, token, onChanged }: { id: string; token: string; onChanged: () => void }) {
  const [report, setReport] = useState<FullReport | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const auth = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    let urls: string[] = [];
    api<FullReport>(`/api/review/reports/${id}`, { headers: auth }).then(async (r) => {
      setReport(r);
      // Photos need the bearer token, so fetch them as blobs instead of plain <img src>.
      urls = await Promise.all(
        r.photos.map(async (name) => {
          const res = await fetch(`${API_URL}/api/review/reports/${id}/photos/${name}`, { headers: auth });
          return URL.createObjectURL(await res.blob());
        }),
      );
      setPhotoUrls(urls);
    });
    return () => urls.forEach(URL.revokeObjectURL);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the report changes
  }, [id, token]);

  async function setStatus(status: string) {
    await api(`/api/review/reports/${id}`, {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setReport((r) => (r ? { ...r, status } : r));
    onChanged();
  }

  if (!report) return <Loader2 className="animate-spin" />;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {formatDate(report.createdAt)} · {report.state}
          {report.lga ? `, ${report.lga}` : ""}
        </span>
        <select value={report.status} onChange={(e) => setStatus(e.target.value)} className="h-7 rounded-md border px-2 text-xs">
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
      <details>
        <summary className="cursor-pointer text-muted-foreground">Evidence pack</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{report.evidence.markdown}</pre>
      </details>
    </div>
  );
}

export function ReviewDashboard() {
  // undefined = not signed in or out during this visit, so use the token stored for this tab.
  const storedToken = useClientValue(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [tokenOverride, setToken] = useState<string | null | undefined>(undefined);
  const token = tokenOverride === undefined ? storedToken || null : tokenOverride;
  const [draftToken, setDraftToken] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const load = useCallback(() => setRefresh((n) => n + 1), []);

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
  }, [token, refresh]);

  function signIn(event: FormEvent) {
    event.preventDefault();
    try {
      sessionStorage.setItem(TOKEN_KEY, draftToken);
    } catch {
      /* keep in memory only */
    }
    setToken(draftToken);
  }

  function signOut() {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
    setGroups(null);
  }

  if (!token) {
    return (
      <form onSubmit={signIn} className="mx-auto flex max-w-sm flex-col gap-3">
        <h1 className="text-xl font-semibold">Reviewer access</h1>
        <p className="text-sm text-muted-foreground">Enter the reviewer token (ADMIN_TOKEN on the API server).</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} autoComplete="off" />
        <Button type="submit" disabled={!draftToken}>
          Continue
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incident groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reports about the same product and batch. Grouping is for review only and is not a finding that a product
            is counterfeit.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut /> Sign out
        </Button>
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
              Batch <span className="font-mono">{group.batchNumber ?? "not recorded"}</span> · {group.states.join(", ")} ·
              last {formatDate(group.lastReportedAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {group.matchingAlerts.map((alert) => (
              <a key={alert.id} href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                {alert.title} <ExternalLink className="size-3 shrink-0" />
              </a>
            ))}
            <p className="text-xs text-muted-foreground">
              {Object.entries(group.statuses)
                .map(([s, n]) => `${n} ${s.replaceAll("_", " ")}`)
                .join(" · ")}
            </p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setOpen(open === group.key ? null : group.key)}>
              {open === group.key ? "Hide reports" : "Show reports"}
            </Button>
            {open === group.key && group.reportIds.map((id) => <ReportDetail key={id} id={id} token={token} onChanged={load} />)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
