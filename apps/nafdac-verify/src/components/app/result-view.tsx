"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CircleHelp,
  ExternalLink,
  Flag,
  Info,
  Loader2,
  ScanLine,
  SearchX,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ApiError,
  ISSUE_LABELS,
  postJson,
  saveDraft,
  type AlertMatch,
  type CheckResult,
  type Explanation,
  type LabelFields,
} from "@/lib/api";
import { formatDate } from "@/lib/format";
import { sessionStore, type ScanSession } from "@/lib/stores";
import { useStore } from "@/lib/use-store";
import { verdictOf, type VerdictKind } from "@/lib/verdict";
import { cn } from "@/lib/utils";
import { ScanButton } from "./scanner-sheet";
import { BackLink, Eyebrow, Notice, Page, Pill, PRIMARY_ACTION, SECONDARY_ACTION, Section, StepBar, Surface, TONES, type Tone } from "./ui";

interface VerdictCopy {
  tone: Tone;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  steps: string[];
}

// A register match cannot prove a pack is genuine, so no copy here says "genuine" or "safe".
const COPY: Record<VerdictKind, VerdictCopy> = {
  alert: {
    tone: "danger",
    icon: ShieldAlert,
    eyebrow: "NAFDAC alert",
    title: "This matches a NAFDAC alert",
    steps: ["Don't take it until a pharmacist has checked it.", "Keep the pack and your receipt.", "Report it so reviewers can pass it to NAFDAC."],
  },
  mismatch: {
    tone: "danger",
    icon: X,
    eyebrow: "Record mismatch",
    title: "Details differ from the NAFDAC record",
    steps: ["Check the details you entered against the pack.", "If they are right, don't take it until a pharmacist has checked it.", "Report it so reviewers can look into it."],
  },
  possible_alert: {
    tone: "caution",
    icon: TriangleAlert,
    eyebrow: "Check the alerts",
    title: "Possibly related NAFDAC alerts",
    steps: ["Compare the batch number on your pack with the alerts below.", "If it matches, don't take it and report it.", "Ask a pharmacist if you're unsure."],
  },
  match: {
    tone: "safe",
    icon: Check,
    eyebrow: "Registered",
    title: "Registered with NAFDAC, no alerts found",
    steps: [],
  },
  not_found: {
    tone: "caution",
    icon: SearchX,
    eyebrow: "Not in the register",
    title: "No NAFDAC registration found",
    steps: ["Check the registration number against the pack.", "Ask a pharmacist before you use it.", "If it is still not found, report it."],
  },
  unverified: {
    tone: "neutral",
    icon: CircleHelp,
    eyebrow: "Not enough to check",
    title: "We couldn't check this pack",
    steps: ["Add the registration number from the pack.", "Retake a clear, well-lit photo of the label.", "Ask a pharmacist if you're unsure."],
  },
};

const REGISTRY_LABEL: Record<CheckResult["registry"]["status"], { label: string; tone: Tone }> = {
  registered: { label: "Registration number found", tone: "safe" },
  registered_details_differ: { label: "Registered to a different product", tone: "danger" },
  registered_ambiguous: { label: "Number listed for several products", tone: "caution" },
  not_in_greenbook: { label: "Not in the NAFDAC Greenbook", tone: "caution" },
  not_provided: { label: "No registration number given", tone: "neutral" },
};

/** One-tap feedback, sent once. Failures are silent: feedback is optional. */
function FeedbackButtons({
  question,
  options,
  payload,
}: {
  question: string;
  options: { label: string; value: string }[];
  payload: Record<string, unknown>;
}) {
  const [sent, setSent] = useState(false);
  if (sent) return <p className="text-xs text-ink-muted">Thanks, that helps us improve the checks.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-muted">{question}</span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            setSent(true);
            postJson("/api/feedback", { ...payload, value: option.value }).catch(() => {});
          }}
          className="h-8 rounded-lg border border-line bg-surface px-3 font-semibold hover:bg-sunken"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Renders "[1]" citations as links to the numbered sources. */
function CitedText({ explanation }: { explanation: Explanation }) {
  const byNumber = new Map(explanation.sources.map((source) => [source.n, source]));
  return (
    <p className="text-sm leading-relaxed whitespace-pre-line">
      {explanation.text.split(/(\[\d+\])/g).map((part, index) => {
        const n = /^\[(\d+)\]$/.exec(part)?.[1];
        const source = n ? byNumber.get(Number(n)) : undefined;
        return source ? (
          <a key={index} href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-pink-strong hover:underline">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </p>
  );
}

function AlertCard({ alert, scanId }: { alert: AlertMatch; scanId: string | null }) {
  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-1">
        <Eyebrow
          tone={alert.strength === "strong" ? "danger" : "caution"}
          lead={alert.strength === "strong" ? "Close match" : "Possible match"}
          rest={alert.issueTypes.map((type) => ISSUE_LABELS[type] ?? type)}
        />
        <h3 className="text-[15px] leading-snug font-semibold">{alert.title}</h3>
        <span className="text-xs text-ink-muted">
          {alert.alertNumber ? `Alert ${alert.alertNumber} · ` : ""}
          {formatDate(alert.publishedAt)}
        </span>
      </div>
      <ul className="flex flex-col gap-1 text-sm text-ink-muted">
        {alert.reasons.map((reason) => (
          <li key={reason} className="flex gap-2">
            <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-faint" />
            {reason}
          </li>
        ))}
      </ul>
      {alert.batchNumbers.length > 0 ? (
        <div className="rounded-field bg-sunken px-3 py-2 text-sm">
          <span className="text-xs text-ink-muted">Batches named in the alert</span>
          <p className="font-mono text-[13px]">{alert.batchNumbers.slice(0, 8).join(", ")}</p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-4 text-sm font-semibold">
        <Link href={`/alerts?id=${alert.alertId}`} className="text-blue">
          Details{alert.imageCount ? ` and ${alert.imageCount} photo${alert.imageCount > 1 ? "s" : ""}` : ""}
        </Link>
        <a href={alert.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-ink-muted">
          NAFDAC source <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <div className="border-t border-line pt-3">
        <FeedbackButtons
          question="Is this alert about your product?"
          options={[
            { label: "Yes", value: "relevant" },
            { label: "No", value: "not_relevant" },
          ]}
          payload={{ kind: "alert_relevance", scanId, alertId: alert.alertId, matchStrength: alert.strength }}
        />
      </div>
    </Surface>
  );
}

function Explain({ fields, scanId }: { fields: LabelFields; scanId: string | null }) {
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setLoading(true);
    setError(null);
    try {
      setExplanation(await postJson<Explanation>("/api/explain", { fields }));
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not get an explanation.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-field", TONES.accent)}>
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">What does this mean?</span>
          <span className="text-xs text-ink-muted">Gemma explains the result using only the NAFDAC sources above.</span>
        </div>
      </div>
      {explanation ? (
        <>
          <CitedText explanation={explanation} />
          <FeedbackButtons
            question="Was this helpful?"
            options={[
              { label: "Helpful", value: "helpful" },
              { label: "Not helpful", value: "not_helpful" },
            ]}
            payload={{ kind: "explanation_rating", scanId }}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={explain}
          disabled={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-field bg-pink-tint text-sm font-semibold text-pink-strong disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
          {loading ? "Explaining…" : "Explain this result"}
        </button>
      )}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </Surface>
  );
}

function Result({ session, result }: { session: ScanSession; result: CheckResult }) {
  const router = useRouter();
  const verdict = verdictOf(result);
  const copy = COPY[verdict];
  const Icon = copy.icon;
  const registry = REGISTRY_LABEL[result.registry.status];
  const { fields } = session;
  const serious = verdict === "alert" || verdict === "mismatch";

  function report() {
    saveDraft({ fields, scanId: session.scanId });
    router.push("/report", { transitionTypes: ["nav-forward"] });
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <BackLink href="/review" label="Back to details" />
        <StepBar step={3} />
      </header>

      <section className={cn("flex flex-col gap-4 rounded-sheet p-5", TONES[copy.tone])}>
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-field bg-surface">
            <Icon className="size-6" strokeWidth={2.25} aria-hidden />
          </span>
          <span className="text-xs font-semibold tracking-wider uppercase">{copy.eyebrow}</span>
        </div>
        <div className="flex flex-col gap-1.5 text-ink">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-sm leading-relaxed text-ink-muted">{result.summary}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-current/15 pt-3 text-sm text-ink">
          {[
            ["Medicine", fields.productName],
            ["Reg. no.", fields.registrationNumber],
            ["Batch", fields.batchNumber],
            ["Expiry", fields.expiryDate],
          ]
            .filter(([, value]) => value)
            .map(([term, value]) => (
              <div key={term} className="flex min-w-0 flex-col">
                <dt className="text-xs text-ink-muted">{term}</dt>
                <dd className={cn("truncate font-medium", term !== "Medicine" && "font-mono")}>{value}</dd>
              </div>
            ))}
        </dl>
      </section>

      {copy.steps.length > 0 ? (
        <Section title="What to do now">
          <Surface className="p-4">
            <ol className="flex flex-col gap-3">
              {copy.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm leading-snug">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-tint text-xs font-semibold text-blue-strong">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Surface>
        </Section>
      ) : null}

      {result.alerts.length > 0 ? (
        <Section title={`Matching alerts (${result.alerts.length})`}>
          {result.alerts.map((alert) => (
            <AlertCard key={`${alert.alertId}-${session.scanId}`} alert={alert} scanId={session.scanId} />
          ))}
        </Section>
      ) : null}

      <Section title="NAFDAC register">
        <Surface className="flex flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{registry.label}</span>
              <span className="text-sm text-ink-muted">{result.registry.note}</span>
            </div>
          </div>
          {result.registry.records.slice(0, 4).map((record, index) => (
            <div key={index} className="flex flex-col gap-1 rounded-field bg-sunken p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{record.productName}</span>
                {record.approvalStatus ? (
                  <Pill tone={record.approvalStatus === "Active" ? "safe" : "danger"}>{record.approvalStatus}</Pill>
                ) : null}
              </div>
              <span className="text-ink-muted">{[record.strength, record.manufacturer].filter(Boolean).join(" · ")}</span>
              {record.differences.length > 0 ? <span className="text-danger">Differs from your pack: {record.differences.join(", ")}</span> : null}
              {record.sourceUrl ? (
                <a href={record.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue">
                  Greenbook record <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </div>
          ))}
        </Surface>
      </Section>

      <Explain fields={fields} scanId={session.scanId} />

      <Notice icon={Info}>
        A register match means the label agrees with NAFDAC&apos;s records. It cannot prove the pack itself is genuine, so buy
        from licensed pharmacies.
      </Notice>

      <div className="flex flex-col gap-2.5">
        <button type="button" onClick={report} className={serious ? PRIMARY_ACTION : SECONDARY_ACTION}>
          <Flag aria-hidden /> Report this product
        </button>
        <ScanButton className={serious ? SECONDARY_ACTION : PRIMARY_ACTION}>
          <ScanLine aria-hidden /> Scan another
        </ScanButton>
      </div>
    </div>
  );
}

export function ResultView() {
  const session = useStore(sessionStore);

  return (
    <Page>
      {session?.result ? (
        <Result session={session} result={session.result} />
      ) : (
        <Surface className="flex flex-col gap-3 p-5">
          <h1 className="text-lg font-semibold">No result yet</h1>
          <p className="text-sm text-ink-muted">Scan a pack or type its details to see a result.</p>
          <ScanButton className={PRIMARY_ACTION}>
            <ScanLine aria-hidden /> Scan a pack
          </ScanButton>
        </Surface>
      )}
    </Page>
  );
}
