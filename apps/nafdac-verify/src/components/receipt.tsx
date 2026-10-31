"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ApiError, formatDate } from "@/lib/api";
import { useClientValue, useSearchParam } from "@/lib/use-client-value";

interface MyReport {
  id: string;
  createdAt: string;
  status: string;
  evidence: { markdown: string };
}

const STATUS: Record<string, string> = {
  submitted: "Received, waiting for review",
  in_review: "Being reviewed",
  forwarded_to_nafdac: "Forwarded to NAFDAC",
  dismissed: "Closed after review",
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
  if (hydrated && (!id || !token)) return <p className="text-destructive">This receipt link is incomplete.</p>;
  if (error) return <p className="text-destructive">{error}</p>;
  if (!report) return <Loader2 className="animate-spin" />;

  function download() {
    const blob = new Blob([report!.evidence.markdown], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `safemeds-report-${report!.id.slice(0, 8)}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <p className="font-medium">Report received</p>
          <p className="text-sm">
            Bookmark this page to check its status. Anyone with this link can view the report, so share it carefully.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Status: {STATUS[report.status] ?? report.status}</CardTitle>
          <CardDescription>Submitted {formatDate(report.createdAt)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            This evidence pack is ready to send to NAFDAC through its Med Safety app or nafdac.gov.ng.
          </p>
          <pre className="max-h-96 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">{report.evidence.markdown}</pre>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(report.evidence.markdown);
                setCopied(true);
              }}
            >
              <Copy /> {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="outline" onClick={download}>
              <Download /> Download
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
