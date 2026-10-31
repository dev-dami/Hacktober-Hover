"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, ApiError, assetUrl, ISSUE_LABELS, type AlertDetail, type AlertSummary } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSearchParam } from "@/lib/use-client-value";
import { cn } from "@/lib/utils";
import { Chip, Eyebrow, Notice, Page, PageHeader, Surface, type Tone } from "./ui";

const TYPES = [
  { value: "", label: "All" },
  { value: "drug", label: "Medicines" },
  { value: "falsified", label: "Falsified" },
  { value: "recall", label: "Recalls" },
  { value: "vaccine_biologic", label: "Vaccines" },
  { value: "medical_device", label: "Devices" },
  { value: "food", label: "Food" },
  { value: "cosmetic", label: "Cosmetics" },
];

const ISSUE_TONE: Record<string, Tone> = { falsified: "danger", contaminated: "danger", recall: "caution", substandard: "caution" };

function IssueLine({ types }: { types: string[] }) {
  const [first, ...rest] = types.map((type) => ISSUE_LABELS[type] ?? type);
  return <Eyebrow tone={ISSUE_TONE[types[0] ?? ""] ?? "neutral"} lead={first} rest={rest} />;
}

function AlertView({ id, onBack }: { id: number; onBack: () => void }) {
  const [alert, setAlert] = useState<AlertDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<AlertDetail>(`/api/alerts/${id}`).then(setAlert, (e) => setError(e instanceof ApiError ? e.message : "Could not load this alert."));
  }, [id]);

  return (
    <Page>
      <button
        type="button"
        onClick={onBack}
        aria-label="All alerts"
        className="flex size-10 items-center justify-center rounded-field border border-line bg-surface"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </button>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!alert && !error ? <Loader2 className="size-6 animate-spin text-ink-faint" aria-label="Loading" /> : null}
      {alert ? (
        <article className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <IssueLine types={alert.issueTypes} />
            <h1 className="text-xl leading-snug font-semibold tracking-tight">{alert.title}</h1>
            <p className="text-sm text-ink-muted">
              {alert.alertNumber ? `Alert ${alert.alertNumber} · ` : ""}
              {formatDate(alert.publishedAt)}
            </p>
          </div>
          {alert.images.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {alert.images.map((image) => (
                <a key={image.url} href={assetUrl(image.url)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- photos served by the API */}
                  <img src={assetUrl(image.url)} alt="Product photo from the NAFDAC alert" className="aspect-square w-full rounded-field border border-line object-cover" />
                </a>
              ))}
            </div>
          ) : null}
          <Surface className="p-4 text-sm leading-relaxed whitespace-pre-line">{alert.text}</Surface>
          <a
            href={alert.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-field border border-line bg-surface text-sm font-semibold"
          >
            Read on nafdac.gov.ng <ExternalLink className="size-4" aria-hidden />
          </a>
        </article>
      ) : null}
    </Page>
  );
}

export function AlertsFeed() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [results, setResults] = useState<AlertSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // undefined = nothing chosen during this visit, so fall back to ?id= from the URL.
  const [chosen, setChosen] = useState<number | null | undefined>(undefined);
  const urlId = Number(useSearchParam("id")) || null;
  const selected = chosen === undefined ? urlId : chosen;

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, type, limit: "50" });
      api<{ results: AlertSummary[] }>(`/api/alerts?${params}`).then(
        (response) => {
          setResults(response.results);
          setError(null);
        },
        (e) => setError(e instanceof ApiError ? e.message : "Could not load alerts."),
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [query, type]);

  function open(id: number | null) {
    setChosen(id);
    window.history.replaceState(null, "", id ? `/alerts?id=${id}` : "/alerts");
  }

  if (selected) return <AlertView id={selected} onBack={() => open(null)} />;

  return (
    <Page>
      <PageHeader title="NAFDAC alerts" subtitle="Recalls, falsified product warnings and watchlists published by NAFDAC." />

      <div className="flex flex-col gap-3">
        <label className="relative">
          <Search className="absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-ink-faint" aria-hidden />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Product, batch number or maker"
            aria-label="Search alerts"
            className="h-12 rounded-field border-line bg-surface pl-10 text-[15px] shadow-card"
          />
        </label>
        <div role="group" aria-label="Alert type" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
          {TYPES.map((option) => (
            <Chip key={option.value} active={type === option.value} onClick={() => setType(option.value)}>
              {option.label}
            </Chip>
          ))}
        </div>
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!results && !error ? <Loader2 className="size-6 animate-spin self-center text-ink-faint" aria-label="Loading" /> : null}
      {results?.length === 0 ? <Surface className="p-4 text-sm text-ink-muted">No alerts match that search.</Surface> : null}

      <div className="flex flex-col gap-3">
        {results?.map((alert) => (
          <button key={alert.id} type="button" onClick={() => open(alert.id)} className="text-left">
            <Surface className="flex items-start gap-3 p-4 transition-colors hover:bg-sunken/60">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {alert.issueTypes.length > 0 ? <IssueLine types={alert.issueTypes} /> : null}
                <span className="text-[15px] leading-snug font-semibold">{alert.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                  {formatDate(alert.publishedAt)}
                  {alert.imageCount ? (
                    <span className="inline-flex items-center gap-1">
                      <ImageIcon className="size-3.5" aria-hidden />
                      {alert.imageCount}
                    </span>
                  ) : null}
                  {alert.batchNumbers.length > 0 ? (
                    <span className={cn("truncate font-mono")}>Batch {alert.batchNumbers.slice(0, 3).join(", ")}</span>
                  ) : null}
                </span>
              </div>
              <ChevronRight className="mt-1 size-5 shrink-0 text-ink-faint" aria-hidden />
            </Surface>
          </button>
        ))}
      </div>
    </Page>
  );
}
