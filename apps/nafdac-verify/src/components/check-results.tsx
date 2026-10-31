"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  formatDate,
  ISSUE_LABELS,
  postJson,
  type CheckResult,
  type Explanation,
  type LabelFields,
} from "@/lib/api";

const REGISTRY_TONE: Record<CheckResult["registry"]["status"], { label: string; tone: "ok" | "warn" | "info" }> = {
  registered: { label: "Registration number found", tone: "ok" },
  registered_details_differ: { label: "Registered to a different product", tone: "warn" },
  registered_ambiguous: { label: "Number listed for several products", tone: "warn" },
  not_in_greenbook: { label: "Not in the NAFDAC Greenbook", tone: "warn" },
  not_provided: { label: "No registration number read", tone: "info" },
};

function Tone({ tone }: { tone: "ok" | "warn" | "info" }) {
  if (tone === "ok") return <CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden />;
  if (tone === "warn") return <AlertTriangle className="size-5 shrink-0 text-amber-600" aria-hidden />;
  return <Info className="size-5 shrink-0 text-muted-foreground" aria-hidden />;
}

/** Renders "[1]" citations as links to the numbered sources. */
function CitedText({ explanation }: { explanation: Explanation }) {
  const byNumber = new Map(explanation.sources.map((s) => [s.n, s]));
  const parts = explanation.text.split(/(\[\d+\])/g);
  return (
    <p className="whitespace-pre-line leading-relaxed">
      {parts.map((part, i) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        const source = n ? byNumber.get(Number(n)) : undefined;
        return source ? (
          <a key={i} href={source.url} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 hover:underline">
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </p>
  );
}

export function CheckResults({ result, fields }: { result: CheckResult; fields: LabelFields }) {
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const strong = result.alerts.some((a) => a.strength === "strong");
  const registry = REGISTRY_TONE[result.registry.status];

  async function explain() {
    setExplaining(true);
    setExplainError(null);
    try {
      setExplanation(await postJson<Explanation>("/api/explain", { fields }));
    } catch (error) {
      setExplainError(error instanceof ApiError ? error.message : "Could not get an explanation.");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        className={
          strong
            ? "rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"
            : result.alerts.length
              ? "rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
              : "rounded-xl border bg-muted/40 p-4"
        }
      >
        <p className="font-medium">
          {strong ? "Matches a NAFDAC alert" : result.alerts.length ? "Possibly related alerts" : "No matching alerts"}
        </p>
        <p className="mt-1 text-sm">{result.summary}</p>
      </div>

      <Card size="sm">
        <CardHeader>
          <div className="flex items-start gap-2">
            <Tone tone={registry.tone} />
            <div>
              <CardTitle>{registry.label}</CardTitle>
              <CardDescription className="mt-1">{result.registry.note}</CardDescription>
            </div>
          </div>
        </CardHeader>
        {result.registry.records.length > 0 && (
          <CardContent className="flex flex-col gap-2">
            {result.registry.records.slice(0, 4).map((record, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{record.productName}</span>
                  {record.approvalStatus && (
                    <Badge variant={record.approvalStatus === "Active" ? "secondary" : "destructive"}>
                      {record.approvalStatus}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {[record.strength, record.manufacturer].filter(Boolean).join(" · ")}
                </p>
                {record.differences.length > 0 && (
                  <p className="mt-1 text-amber-700">Differs from your label: {record.differences.join(", ")}</p>
                )}
                {record.sourceUrl && (
                  <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs hover:underline">
                    Greenbook record <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      {result.alerts.map((alert) => (
        <Card key={alert.alertId} size="sm">
          <CardHeader>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={alert.strength === "strong" ? "destructive" : "outline"}>
                {alert.strength === "strong" ? "Close match" : "Possible match"}
              </Badge>
              {alert.issueTypes.map((t) => (
                <Badge key={t} variant="secondary">
                  {ISSUE_LABELS[t] ?? t}
                </Badge>
              ))}
            </div>
            <CardTitle className="mt-2 leading-snug">{alert.title}</CardTitle>
            <CardDescription>
              {alert.alertNumber ? `Alert ${alert.alertNumber} · ` : ""}
              {formatDate(alert.publishedAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <ul className="list-disc pl-5 text-muted-foreground">
              {alert.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {alert.batchNumbers.length > 0 && (
              <p>
                <span className="text-muted-foreground">Batches named in the alert: </span>
                <span className="font-mono">{alert.batchNumbers.slice(0, 8).join(", ")}</span>
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <a href={`/alerts?id=${alert.alertId}`} className="text-emerald-700 hover:underline">
                Details{alert.imageCount ? ` and ${alert.imageCount} photo${alert.imageCount > 1 ? "s" : ""}` : ""}
              </a>
              <a href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                NAFDAC source <ExternalLink className="size-3" />
              </a>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-emerald-600" aria-hidden /> What does this mean?
          </CardTitle>
          <CardDescription>Gemma explains the result using only the NAFDAC sources above.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {explanation ? (
            <CitedText explanation={explanation} />
          ) : (
            <Button variant="outline" onClick={explain} disabled={explaining}>
              {explaining ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {explaining ? "Explaining…" : "Explain this result"}
            </Button>
          )}
          {explainError && <p className="mt-2 text-destructive">{explainError}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
