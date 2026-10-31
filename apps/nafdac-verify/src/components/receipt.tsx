"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, Download, Loader2 } from "lucide-react";
import { Notice, Page, Pill, Section, SECONDARY_ACTION, Surface, type Tone } from "@/components/app/ui";
import { api, ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useClientValue, useSearchParam } from "@/lib/use-client-value";

interface MyReport {
  id: string;
  createdAt: string;
  status: string;
  evidence: { markdown: string };
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  submitted: { label: "Waiting for review", tone: "info" },
  in_review: { label: "Being reviewed", tone: "accent" },
  forwarded_to_nafdac: { label: "Forwarded to NAFDAC", tone: "safe" },
  dismissed: { label: "Closed after review", tone: "neutral" },
};

export function Receipt() {
  const id = useSearchParam("id");
  const token = useSearchParam("token");
  const [report, setReport] = useState<MyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id || !token) return;
    api<MyReport>(`/api/reports/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`).then(setReport, (e) =>
      setError(e instanceof ApiError ? e.message : "Could not load the report."),
    );
  }, [id, token]);

  // "" during the server render, "1" in the browser: avoids flashing the error before the URL is read.
  const hydrated = useClientValue(() => "1");
  const failure = hydrated && (!id || !token) ? "This receipt link is incomplete." : error;

  if (failure || !report) {
    return (
      <Page>
        {failure ? <Notice tone="danger">{failure}</Notice> : <Loader2 className="size-6 animate-spin self-center text-ink-faint" aria-label="Loading" />}
      </Page>
    );
  }

  function download() {
    const blob = new Blob([report!.evidence.markdown], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `medfify-report-${report!.id.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const status = STATUS[report.status] ?? { label: report.status, tone: "neutral" as Tone };

  return (
    <Page>
      <div className="flex flex-col items-center gap-3 pt-4 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-safe-tint text-safe">
          <CheckCircle2 className="size-8" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Report received</h1>
        <p className="text-sm leading-relaxed text-ink-muted">
          Bookmark this page to follow its status. Anyone with the link can see the report, so share it with care.
        </p>
      </div>

      <Surface className="flex items-center justify-between gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-ink-muted">Status</span>
          <span className="text-sm font-semibold">Sent {formatDate(report.createdAt)}</span>
        </div>
        <Pill tone={status.tone}>{status.label}</Pill>
      </Surface>

      <Section title="Evidence pack">
        <p className="text-sm text-ink-muted">Ready to send to NAFDAC through its Med Safety app or nafdac.gov.ng.</p>
        <pre className="max-h-80 overflow-auto rounded-card border border-line bg-surface p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {report.evidence.markdown}
        </pre>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className={SECONDARY_ACTION}
            onClick={async () => {
              await navigator.clipboard.writeText(report.evidence.markdown);
              setCopied(true);
            }}
          >
            <Copy aria-hidden /> {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className={SECONDARY_ACTION} onClick={download}>
            <Download aria-hidden /> Download
          </button>
        </div>
      </Section>

      <Link href="/" className="text-center text-sm font-semibold text-blue">
        Back to home
      </Link>
    </Page>
  );
}
