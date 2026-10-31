"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Check, ExternalLink, Info, ScanLine, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { UNREADABLE, demoRecords, type Label } from "@hacktober/verify-core";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatExpiry } from "@/lib/format";
import { sessionStore, type ScanSession } from "@/lib/stores";
import { useStore } from "@/lib/use-store";
import { WARNING_TEXT, runCheck, type ComparisonRow, type RowStatus } from "@/lib/verify";
import { cn } from "@/lib/utils";
import { BackLink, Notice, Page, Pill, Surface, TONES, TONE_TEXT, type Tone } from "./ui";

interface VerdictCopy {
  tone: Tone;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  steps: string[];
}

// "Matches" is deliberate: a record match can't prove a pack is genuine, so the copy never says "Genuine".
const COPY: Record<Label, VerdictCopy> = {
  record_match: {
    tone: "forest",
    icon: Check,
    eyebrow: "Record match",
    title: "Matches NAFDAC record",
    steps: [],
  },
  record_mismatch: {
    tone: "coral",
    icon: X,
    eyebrow: "Record mismatch",
    title: "Doesn't match NAFDAC record",
    steps: [
      "Don't take it until a pharmacist has checked it.",
      "Keep the pack and your receipt.",
      "Report it to NAFDAC so they can investigate.",
    ],
  },
  not_found: {
    tone: "slate",
    icon: TriangleAlert,
    eyebrow: "No record found",
    title: "No NAFDAC record found",
    steps: [
      "Check the registration number against the pack and fix it if it's wrong.",
      "Try the Lookup tab to search the register by name.",
      "If it still isn't found, ask a pharmacist before using it.",
    ],
  },
  unverified: {
    tone: "amber",
    icon: TriangleAlert,
    eyebrow: "Couldn't verify",
    title: "Couldn't verify this pack",
    steps: [
      "Retake a clear photo of the front of the pack.",
      "Add the registration number by hand on the review screen.",
      "Ask a pharmacist if you're unsure.",
    ],
  },
};

const ROW_STATUS: Record<RowStatus, { tone: Tone; text: string }> = {
  match: { tone: "forest", text: "Matches" },
  differ: { tone: "coral", text: "Differs" },
  unreadable: { tone: "amber", text: "Unreadable" },
  not_printed: { tone: "neutral", text: "Not printed" },
  no_record: { tone: "neutral", text: "No record" },
};

const ROW_ICON: Record<RowStatus, LucideIcon> = {
  match: Check,
  differ: X,
  unreadable: TriangleAlert,
  not_printed: Info,
  no_record: Info,
};

function showValue(value: string | null): string {
  if (value === null || value === "") return "—";
  return value === UNREADABLE ? "Unreadable" : value;
}

function Row({ row }: { row: ComparisonRow }) {
  const status = ROW_STATUS[row.status];
  const Icon = ROW_ICON[row.status];
  const differs = row.status === "differ";
  return (
    <div className="flex items-start gap-3 border-b border-surface-sunken px-4 py-3.5 last:border-b-0">
      <div className={cn("mt-0.5 flex size-[26px] shrink-0 items-center justify-center rounded-full", TONES[status.tone])}>
        <Icon className="size-3.5" aria-hidden />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-bold text-ink-muted">{row.label}</span>
          <span className="sr-only">{status.text}</span>
        </div>
        {differs ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs font-bold text-ink-faint">On the pack</div>
              <div className="font-bold text-coral">{showValue(row.pack)}</div>
            </div>
            <div>
              <div className="text-xs font-bold text-ink-faint">NAFDAC record</div>
              <div className="font-bold">{showValue(row.record)}</div>
            </div>
          </div>
        ) : (
          <div className={cn("text-sm font-bold", row.field === "registrationNumber" && "font-mono")}>
            {showValue(row.pack)}
          </div>
        )}
      </div>
    </div>
  );
}

function Result({ session }: { session: ScanSession }) {
  // Memoised so the scan date doesn't shift between renders of one result.
  const check = useMemo(
    () => runCheck(session.label, demoRecords, new Date().toISOString().slice(0, 10)),
    [session.label],
  );
  const { verdict, record, rows } = check;
  const copy = COPY[verdict.label];
  const Icon = copy.icon;
  const { label } = session;

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex items-center justify-between">
        <BackLink href="/review" label="Back to review" />
        <h1 className="text-[17px] font-semibold">Result</h1>
        <div className="size-11" aria-hidden />
      </header>

      <section className="relative flex flex-col items-center gap-3.5 overflow-hidden rounded-3xl bg-card px-[22px] pt-7 pb-[22px] text-center shadow-card">
        <div aria-hidden className={cn("absolute inset-x-0 top-0 h-[150px]", TONES[copy.tone])} />
        <div className="relative flex size-[104px] items-center justify-center rounded-full bg-card shadow-card">
          <div className={cn("flex size-[78px] items-center justify-center rounded-full", TONES[copy.tone])}>
            <Icon className="size-10" strokeWidth={2.6} aria-hidden />
          </div>
        </div>
        <div className="relative mt-1 flex flex-col gap-1.5">
          <div className={cn("text-xs font-extrabold tracking-[0.08em] uppercase", TONE_TEXT[copy.tone])}>
            {copy.eyebrow}
          </div>
          <h2 className="text-[28px] leading-[1.12] font-semibold tracking-[-0.02em]">{copy.title}</h2>
          <p className="text-[15px] leading-normal text-ink-muted">{verdict.reason}</p>
        </div>
        <div className="relative flex flex-wrap justify-center gap-2">
          {label.productName ? <Pill tone="neutral">{label.productName}</Pill> : null}
          {label.registrationNumber ? (
            <Pill tone="neutral" mono>
              {label.registrationNumber}
            </Pill>
          ) : null}
          {label.expiryDate && label.expiryDate !== UNREADABLE ? (
            <Pill tone="neutral">Expires {formatExpiry(label.expiryDate)}</Pill>
          ) : null}
        </div>
      </section>

      {verdict.warnings.length > 0 ? (
        <section aria-label="Warnings" className="flex flex-wrap gap-2">
          {verdict.warnings.map((warning) => (
            <Pill key={warning} tone={warning === "expired_packaging" ? "coral" : "amber"} className="text-xs">
              <TriangleAlert className="size-3.5" aria-hidden />
              {WARNING_TEXT[warning]}
            </Pill>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-2.5">
        <h2 className="px-1 text-lg font-semibold">Pack vs. record</h2>
        <Surface className="overflow-hidden">
          {rows.map((row) => (
            <Row key={row.field} row={row} />
          ))}
        </Surface>
      </section>

      {record ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="px-1 text-lg font-semibold">Official record</h2>
          <Surface className="flex flex-col gap-3.5 p-4">
            <dl className="grid grid-cols-2 gap-3.5">
              {[
                ["Status", record.approvalStatus ?? "—"],
                ["Approved", record.approvalDate ? formatDate(record.approvalDate) : "—"],
                ["Dosage form", record.dosageForm ?? "—"],
                ["Registration holder", record.applicant ?? record.manufacturer ?? "—"],
              ].map(([term, value]) => (
                <div key={term} className="flex flex-col gap-0.5">
                  <dt className="text-xs font-bold text-ink-faint">{term}</dt>
                  <dd className="text-sm font-bold">{value}</dd>
                </div>
              ))}
            </dl>
            {record.sourceUrl ? (
              <a
                href={record.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-[46px] items-center justify-center gap-2 rounded-[14px] border border-line bg-surface-sunken text-sm font-extrabold"
              >
                View on NAFDAC Greenbook
                <ExternalLink className="size-4" aria-hidden />
              </a>
            ) : null}
            <p className="text-center text-xs text-ink-faint">Record checked {formatDate(record.checkedAt)}</p>
          </Surface>
        </section>
      ) : null}

      {copy.steps.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h2 className="px-1 text-lg font-semibold">What to do now</h2>
          <Surface className="p-4">
            <ol className="flex flex-col gap-3">
              {copy.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-3 text-sm leading-snug">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-forest-tint text-xs font-extrabold text-forest">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </Surface>
        </section>
      ) : null}

      <Notice tone="neutral">
        <Info className="mt-0.5 size-[18px] shrink-0" aria-hidden />
        <span>
          A matching record means the label agrees with NAFDAC&apos;s register. It can&apos;t prove the pack itself is
          genuine, so buy from licensed pharmacies.
        </span>
      </Notice>

      <div className="flex flex-col gap-2.5">
        <Link href="/scan" transitionTypes={["nav-forward"]} className={cn(buttonVariants(), "h-14 rounded-[18px] text-base font-extrabold shadow-cta")}>
          <ScanLine className="size-5" aria-hidden />
          Scan another
        </Link>
        {verdict.label === "record_mismatch" ? (
          <a
            href="https://nafdac.gov.ng"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline" }), "h-12 rounded-2xl text-[15px] font-extrabold")}
          >
            Report to NAFDAC
            <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : null}
        <Link href="/" transitionTypes={["nav-back"]} className="flex h-[50px] items-center justify-center text-[15px] font-extrabold text-forest">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export function ResultView() {
  const session = useStore(sessionStore);

  return (
    <Page className="gap-[18px]">
      {session ? (
        <Result session={session} />
      ) : (
        <Surface className="flex flex-col gap-3 p-5">
          <h1 className="text-xl font-semibold">No result yet</h1>
          <p className="text-sm text-ink-muted">Scan a pack or pick a demo pack to see a result.</p>
          <Link href="/scan" transitionTypes={["nav-forward"]} className={cn(buttonVariants(), "h-11 rounded-2xl font-extrabold")}>
            Go to scan
          </Link>
        </Surface>
      )}
    </Page>
  );
}
