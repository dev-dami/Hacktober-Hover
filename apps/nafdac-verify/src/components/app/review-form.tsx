"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, Check, CircleHelp, Info, Loader2, Sparkles, TriangleAlert, ZoomIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, ApiError, assetUrl, FIELD_LABELS, postJson, type CheckResult, type FieldName, type FieldStatus, type LabelFields } from "@/lib/api";
import { runReader, type ReaderStep } from "@/lib/reader";
import { emptySession, historyStore, prependHistory, sessionStore, type ScanSession } from "@/lib/stores";
import { useStore } from "@/lib/use-store";
import { verdictOf } from "@/lib/verdict";
import { cn } from "@/lib/utils";
import { ScanButton } from "./scanner-sheet";
import { BackLink, Notice, Page, Pill, PRIMARY_ACTION, StepBar, Surface, type Tone } from "./ui";

const FIELDS: { key: FieldName; mono?: boolean; placeholder: string }[] = [
  { key: "productName", placeholder: "e.g. Paracetamol 500 mg tablets" },
  { key: "registrationNumber", mono: true, placeholder: "e.g. A4-1234" },
  { key: "batchNumber", mono: true, placeholder: "As printed, e.g. B2309" },
  { key: "manufacturer", placeholder: "Company on the pack" },
  { key: "activeIngredients", placeholder: "Separate several with commas" },
  { key: "strength", placeholder: "e.g. 500 mg" },
  { key: "manufacturingDate", mono: true, placeholder: "e.g. 2025-03" },
  { key: "expiryDate", mono: true, placeholder: "e.g. 2027-08" },
];

const CONFIDENCE: Partial<Record<FieldStatus, { tone: Tone; label: string; sure: boolean }>> = {
  agreed: { tone: "safe", label: "Confirmed", sure: true },
  resolved: { tone: "safe", label: "Confirmed", sure: true },
  single_reading: { tone: "caution", label: "Please check", sure: false },
  conflict: { tone: "caution", label: "Unsure", sure: false },
};

const sameFields = (a: LabelFields, b: LabelFields) =>
  (Object.keys(a) as FieldName[]).every((key) => (a[key] ?? null) === (b[key] ?? null));

function Editor({ initial }: { initial: ScanSession }) {
  const router = useRouter();
  const closeupInput = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState(initial);
  const [fields, setFields] = useState<LabelFields>(initial.fields);
  const [steps, setSteps] = useState<ReaderStep[]>([]);
  const [busy, setBusy] = useState<"closeup" | "checking" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = session.agentFields !== null;
  const edited = !read || !sameFields(fields, session.agentFields ?? fields);
  const unsure = (key: FieldName) => {
    const status = session.confidence[key];
    return (status === "conflict" || status === "single_reading") && fields[key] === session.agentFields?.[key];
  };
  const flagged = FIELDS.filter((field) => unsure(field.key)).length;
  const hasAnyField = Object.values(fields).some(Boolean);

  async function onCloseup(file: File | undefined) {
    if (!file || !session.scanId || !session.needPhoto) return;
    const form = new FormData();
    form.append("image", file);
    form.append("fields", JSON.stringify(session.needPhoto.fields));
    setBusy("closeup");
    setSteps([]);
    const next = await runReader(`/api/scans/${session.scanId}/closeup`, { body: form }, session, setSteps);
    setSession(next);
    setFields(next.fields);
    sessionStore.set(next);
    setBusy(null);
    if (closeupInput.current) closeupInput.current.value = "";
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy("checking");
    setError(null);
    try {
      // The confirmed fields become the training label for this photo.
      if (session.scanId) {
        await api(`/api/scans/${session.scanId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
      }
      const result = edited || !session.result ? await postJson<CheckResult>("/api/check", { fields }) : session.result;
      historyStore.set(
        prependHistory(historyStore.getSnapshot(), {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          checkedAt: new Date().toISOString(),
          productName: fields.productName,
          registrationNumber: fields.registrationNumber,
          verdict: verdictOf(result),
          summary: result.summary,
        }),
      );
      sessionStore.set({ ...session, fields, agentFields: fields, result, needPhoto: null });
      router.push("/result", { transitionTypes: ["nav-forward"] });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "The check failed. Try again.");
      setBusy(null);
    }
  }

  const cta = !read ? "Check against NAFDAC" : edited ? "Check with my corrections" : "Details are correct";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 pb-24">
      <header className="flex items-center gap-4">
        <BackLink href="/" label="Back to home" />
        <StepBar step={2} />
      </header>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{read ? "Check what we read" : "Enter the details"}</h1>
        <p className="text-sm leading-relaxed text-ink-muted">
          {read
            ? "Fix anything that doesn't match the pack. Your corrections help the reader learn."
            : "Copy what is printed on the pack. Leave a field empty if you can't find it."}
        </p>
      </div>

      {session.imageUrl ? (
        <Surface className="flex items-center gap-3 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- photo served by the API */}
          <img src={assetUrl(session.imageUrl)} alt="Your photo of the pack" className="size-14 rounded-field bg-sunken object-cover" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold">Your photo</span>
            <span className="text-xs text-ink-muted">
              {!read ? "Not read automatically" : flagged === 0 ? "Everything read clearly" : `${flagged} field${flagged === 1 ? "" : "s"} to check`}
            </span>
          </div>
          <ScanButton className="rounded-field bg-blue-tint px-3 py-2 text-sm font-semibold text-blue-strong">Retake</ScanButton>
        </Surface>
      ) : null}

      {session.aiError ? (
        <Notice tone="caution" icon={TriangleAlert}>
          {session.aiError} You can still type the details in below.
        </Notice>
      ) : null}

      {session.notes ? (
        <Notice tone="accent" icon={Sparkles}>
          <span className="font-semibold">Reader note: </span>
          {session.notes}
        </Notice>
      ) : null}

      {session.needPhoto && session.scanId ? (
        <Surface className="flex flex-col gap-3 border-caution/30 p-4">
          <div className="flex items-start gap-3">
            <ZoomIn className="mt-0.5 size-5 shrink-0 text-caution" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">One more photo, please</span>
              <span className="text-sm text-ink-muted">{session.needPhoto.hint}</span>
            </div>
          </div>
          {busy === "closeup" ? (
            <ol role="status" aria-live="polite" className="flex flex-col gap-1.5 text-sm">
              {steps.map((step, index) => (
                <li key={index} className={cn("flex items-center gap-2", step.done && "text-ink-muted")}>
                  {step.done ? <Check className="size-4 text-safe" aria-hidden /> : <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {step.message}
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex gap-2">
              <input
                ref={closeupInput}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={(event) => void onCloseup(event.target.files?.[0])}
              />
              <button
                type="button"
                onClick={() => closeupInput.current?.click()}
                className="inline-flex h-10 items-center gap-2 rounded-field bg-blue px-4 text-sm font-semibold text-white"
              >
                <Camera className="size-4" aria-hidden /> Add close-up
              </button>
              <button
                type="button"
                onClick={() => setSession({ ...session, needPhoto: null })}
                className="h-10 rounded-field px-3 text-sm font-semibold text-ink-muted hover:bg-sunken"
              >
                It isn&apos;t on the pack
              </button>
            </div>
          )}
        </Surface>
      ) : null}

      <Surface className="divide-y divide-line overflow-hidden">
        {FIELDS.map((field) => {
          const id = `field-${field.key}`;
          const status = session.confidence[field.key];
          const badge = status && fields[field.key] === session.agentFields?.[field.key] ? CONFIDENCE[status] : undefined;
          const flag = unsure(field.key);
          return (
            <div key={field.key} className={cn("flex flex-col gap-2 px-4 py-3", flag && "bg-caution-tint/40")}>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={id} className="text-xs font-medium text-ink-muted">
                  {FIELD_LABELS[field.key]}
                </label>
                {badge ? (
                  <Pill tone={badge.tone}>
                    {badge.sure ? <Check aria-hidden /> : <CircleHelp aria-hidden />}
                    {badge.label}
                  </Pill>
                ) : null}
              </div>
              <Input
                id={id}
                value={fields[field.key] ?? ""}
                placeholder={field.placeholder}
                disabled={busy !== null}
                aria-invalid={flag || undefined}
                onChange={(event) => setFields((current) => ({ ...current, [field.key]: event.target.value || null }))}
                className={cn(
                  "h-11 rounded-field border-transparent bg-sunken px-3 text-[15px] font-medium shadow-none focus-visible:border-blue focus-visible:bg-surface",
                  field.mono && "font-mono",
                  flag && "border-caution/40 bg-surface",
                )}
              />
            </div>
          );
        })}
      </Surface>

      <Notice icon={Info}>
        The registration number is often printed as &quot;NAFDAC Reg. No.&quot;, near the batch number or barcode.
      </Notice>

      {error ? (
        <Notice tone="danger" icon={TriangleAlert}>
          <span role="alert">{error}</span>
        </Notice>
      ) : null}

      <div className="fixed bottom-0 left-1/2 w-full max-w-[440px] -translate-x-1/2 border-t border-line bg-canvas/95 px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur">
        <button type="submit" disabled={!hasAnyField || busy !== null} className={PRIMARY_ACTION}>
          {busy === "checking" ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {busy === "checking" ? "Checking…" : cta}
          {busy === "checking" ? null : <ArrowRight aria-hidden />}
        </button>
      </div>
    </form>
  );
}

/** Opens the details form empty, dropping any earlier scan from this tab. */
export function ManualEntryLink({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <Link href="/review" transitionTypes={["nav-forward"]} onClick={() => sessionStore.set(emptySession())} className={className}>
      {children}
    </Link>
  );
}

export function ReviewForm() {
  const session = useStore(sessionStore);
  // No scan in progress means the user is typing the details in by hand.
  return (
    <Page>
      <Editor key={session ? `scan-${session.scanId}` : "manual"} initial={session ?? emptySession()} />
    </Page>
  );
}
