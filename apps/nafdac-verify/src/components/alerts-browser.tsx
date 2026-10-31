"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ApiError, assetUrl, formatDate, ISSUE_LABELS, type AlertDetail, type AlertSummary } from "@/lib/api";
import { useSearchParam } from "@/lib/use-client-value";

const TYPES = [
  { value: "", label: "All" },
  { value: "drug", label: "Medicines" },
  { value: "food", label: "Food & drink" },
  { value: "cosmetic", label: "Cosmetics" },
  { value: "vaccine_biologic", label: "Vaccines" },
  { value: "medical_device", label: "Devices" },
  { value: "falsified", label: "Falsified" },
  { value: "recall", label: "Recalls" },
];

function AlertView({ id, onBack }: { id: number; onBack: () => void }) {
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AlertDetail>(`/api/alerts/${id}`).then(setAlert, (e) => setError(e instanceof ApiError ? e.message : "Failed to load"));
  }, [id]);

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeft className="size-4" /> All alerts
      </button>
      {error && <p className="text-destructive">{error}</p>}
      {!alert && !error && <Loader2 className="animate-spin" />}
      {alert && (
        <article className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-1.5">
            {alert.issueTypes.map((t) => (
              <Badge key={t} variant="secondary">
                {ISSUE_LABELS[t] ?? t}
              </Badge>
            ))}
          </div>
          <h1 className="text-xl font-semibold leading-snug">{alert.title}</h1>
          <p className="text-sm text-muted-foreground">
            {alert.alertNumber ? `Alert ${alert.alertNumber} · ` : ""}
            {formatDate(alert.publishedAt)} ·{" "}
            <a href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              Read on nafdac.gov.ng <ExternalLink className="size-3" />
            </a>
          </p>
          {alert.images.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {alert.images.map((image) => (
                <a key={image.url} href={assetUrl(image.url)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- photos served by the API */}
                  <img src={assetUrl(image.url)} alt="Product photo from the NAFDAC alert" className="aspect-square w-full rounded-lg border object-cover" />
                </a>
              ))}
            </div>
          )}
          <div className="whitespace-pre-line text-sm leading-relaxed">{alert.text}</div>
        </article>
      )}
    </div>
  );
}

export function AlertsBrowser() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [results, setResults] = useState<AlertSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = nothing chosen in this session yet, so fall back to ?id= from the URL.
  const [chosen, setSelected] = useState<number | null | undefined>(undefined);
  const urlId = Number(useSearchParam("id")) || null;
  const selected = chosen === undefined ? urlId : chosen;

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, type, limit: "50" });
      api<{ results: AlertSummary[] }>(`/api/alerts?${params}`).then(
        (r) => {
          setResults(r.results);
          setError(null);
        },
        (e) => setError(e instanceof ApiError ? e.message : "Failed to load alerts"),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query, type]);

  function open(id: number | null) {
    setSelected(id);
    window.history.replaceState(null, "", id ? `/alerts?id=${id}` : "/alerts");
  }

  if (selected) return <AlertView id={selected} onBack={() => open(null)} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">NAFDAC alerts</h1>
        <p className="mt-1 text-muted-foreground">Recalls, falsified product warnings and watchlists published by NAFDAC.</p>
      </div>
      <label className="relative">
        <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" aria-hidden />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, batch number, manufacturer…"
          className="pl-8"
          aria-label="Search alerts"
        />
      </label>
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`rounded-full border px-3 py-1 text-xs ${type === t.value ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && <p className="text-destructive">{error}</p>}
      {!results && !error && <Loader2 className="animate-spin" />}
      {results?.length === 0 && <p className="text-muted-foreground">No alerts match.</p>}
      {results?.map((alert) => (
        <Card key={alert.id} size="sm" className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => open(alert.id)}>
          <CardHeader>
            <CardTitle className="leading-snug">{alert.title}</CardTitle>
            <CardDescription>
              {formatDate(alert.publishedAt)}
              {alert.imageCount ? ` · ${alert.imageCount} photo${alert.imageCount > 1 ? "s" : ""}` : ""}
            </CardDescription>
          </CardHeader>
          {(alert.issueTypes.length > 0 || alert.batchNumbers.length > 0) && (
            <CardContent className="flex flex-wrap items-center gap-1.5">
              {alert.issueTypes.map((t) => (
                <Badge key={t} variant="secondary">
                  {ISSUE_LABELS[t] ?? t}
                </Badge>
              ))}
              {alert.batchNumbers.length > 0 && (
                <span className="font-mono text-xs text-muted-foreground">Batch {alert.batchNumbers.slice(0, 4).join(", ")}</span>
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
