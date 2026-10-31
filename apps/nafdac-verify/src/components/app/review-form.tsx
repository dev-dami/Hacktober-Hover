"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Info, TriangleAlert } from "lucide-react";
import { UNREADABLE, demoRecords, type ScannedLabel } from "@hacktober/verify-core";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import type { ScannedField } from "@/lib/extract";
import { historyStore, prependHistory, sessionStore, type ScanSession } from "@/lib/stores";
import { runCheck } from "@/lib/verify";
import { useStore } from "@/lib/use-store";
import { cn } from "@/lib/utils";
import { BackLink, Notice, Page, Pill, Surface } from "./ui";

const FIELDS: { key: ScannedField; label: string; mono?: boolean; placeholder: string }[] = [
  { key: "productName", label: "Medicine name", placeholder: "e.g. SampleMed 500" },
  { key: "registrationNumber", label: "NAFDAC registration number", mono: true, placeholder: "e.g. A4-1234" },
  { key: "manufacturer", label: "Manufacturer", placeholder: "As printed on the pack" },
  { key: "activeIngredients", label: "Active ingredients", placeholder: "Separate several with commas" },
  { key: "strength", label: "Strength", placeholder: "e.g. 500 mg" },
  { key: "expiryDate", label: "Expiry date", mono: true, placeholder: "YYYY-MM" },
];

type Draft = Record<ScannedField, string>;

function toDraft(label: ScannedLabel): Draft {
  return {
    productName: label.productName ?? "",
    registrationNumber: label.registrationNumber ?? "",
    manufacturer: label.manufacturer ?? "",
    activeIngredients: label.activeIngredients ?? "",
    strength: label.strength ?? "",
    expiryDate: label.expiryDate ?? "",
  };
}

// An empty field means "not printed on the pack", which the comparison treats differently from [unreadable].
function toLabel(draft: Draft): ScannedLabel {
  const clean = (value: string) => value.trim() || null;
  return {
    productName: clean(draft.productName),
    registrationNumber: clean(draft.registrationNumber),
    manufacturer: clean(draft.manufacturer),
    activeIngredients: clean(draft.activeIngredients),
    strength: clean(draft.strength),
    expiryDate: clean(draft.expiryDate),
  };
}

function Editor({ session }: { session: ScanSession }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(session.label));
  const [error, setError] = useState<string | null>(null);

  const attention = (key: ScannedField): string | null => {
    if (draft[key].trim() === UNREADABLE) return "Unreadable";
    if (session.lowConfidence.includes(key) && draft[key] === (session.label[key] ?? "")) return "Hard to read";
    return null;
  };
  const flagged = FIELDS.filter((field) => attention(field.key)).length;

  function submit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const label = toLabel(draft);
      const { verdict } = runCheck(label, demoRecords, new Date().toISOString().slice(0, 10));
      historyStore.set(
        prependHistory(historyStore.getSnapshot(), {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          checkedAt: new Date().toISOString(),
          productName: label.productName,
          registrationNumber: label.registrationNumber,
          label: verdict.label,
          summary: verdict.reason,
        }),
      );
      sessionStore.set({ ...session, label, lowConfidence: [] });
      router.push("/result", { transitionTypes: ["nav-forward"] });
    } catch (failure) {
      console.error("Comparing the label failed", failure);
      setError("Something went wrong while comparing. Check the fields and try again.");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-32">
      <header className="flex items-center gap-3">
        <BackLink href="/scan" label="Back to scan" />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="text-xs font-bold text-ink-muted">Step 2 of 3</div>
          <div className="grid grid-cols-3 gap-1.5" aria-hidden>
            <div className="h-[5px] rounded-sm bg-forest" />
            <div className="h-[5px] rounded-sm bg-forest" />
            <div className="h-[5px] rounded-sm bg-line" />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em]">Check what we read</h1>
        <p className="text-sm leading-normal text-ink-muted">
          Fix anything that&apos;s wrong. Leave a field empty if it isn&apos;t printed on the pack.
        </p>
      </div>

      <Surface className="flex items-center justify-between gap-3 p-3">
        <div className="flex flex-col gap-0.5 pl-1">
          <div className="text-[15px] font-bold">{session.source === "demo" ? "Demo pack" : "Front of pack"}</div>
          <div className="text-[13px] text-ink-muted">
            {flagged === 0 ? "All fields read clearly" : `${flagged} ${flagged === 1 ? "needs" : "need"} a look`}
          </div>
        </div>
        <Link href="/scan" transitionTypes={["nav-back"]} className="rounded-xl bg-forest-tint px-3 py-2.5 text-[13px] font-extrabold text-forest">
          Retake
        </Link>
      </Surface>

      <Surface className="overflow-hidden rounded-3xl">
        {FIELDS.map((field) => {
          const note = attention(field.key);
          const id = `field-${field.key}`;
          return (
            <div
              key={field.key}
              className={cn(
                "flex flex-col gap-1.5 border-b border-surface-sunken px-4 py-3.5 last:border-b-0",
                note && "bg-amber-tint/50",
              )}
            >
              <div className="flex items-center justify-between">
                <label htmlFor={id} className="text-xs font-bold text-ink-muted">
                  {field.label}
                </label>
                {note ? (
                  <Pill tone="amber">
                    <TriangleAlert className="size-3" aria-hidden />
                    {note}
                  </Pill>
                ) : null}
              </div>
              <Input
                id={id}
                value={draft[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                className={cn(
                  "h-11 rounded-field bg-surface-sunken px-3 text-[15px] font-semibold",
                  field.mono && "font-mono",
                  note && "border-[1.5px] border-amber/50 bg-white",
                )}
              />
              {note ? <p className="text-xs text-amber">Compare with the pack before you continue.</p> : null}
            </div>
          );
        })}
      </Surface>

      <Notice tone="neutral">
        <Info className="mt-0.5 size-[18px] shrink-0" aria-hidden />
        <span>
          Can&apos;t find the registration number? It&apos;s usually printed near the batch number or barcode. Label
          reading is a demo stand-in for now.
        </span>
      </Notice>

      {error ? (
        <Notice tone="coral">
          <span role="alert">{error}</span>
        </Notice>
      ) : null}

      <div className="fixed bottom-0 left-1/2 w-full max-w-[430px] -translate-x-1/2 bg-canvas px-5 pt-4 pb-7 shadow-[0_-18px_30px_-12px_var(--canvas)]">
        <button
          type="submit"
          className={cn(
            buttonVariants(),
            "h-14 w-full rounded-[18px] text-base font-extrabold shadow-cta [&_svg:not([class*='size-'])]:size-5",
          )}
        >
          Compare with NAFDAC record
          <ArrowRight aria-hidden />
        </button>
      </div>
    </form>
  );
}

export function ReviewForm() {
  const session = useStore(sessionStore);

  return (
    <Page>
      {session ? (
        <Editor session={session} />
      ) : (
        <Surface className="flex flex-col gap-3 p-5">
          <h1 className="text-xl font-semibold">Nothing to review yet</h1>
          <p className="text-sm text-ink-muted">Scan a pack or pick a demo pack first.</p>
          <Link href="/scan" transitionTypes={["nav-back"]} className={cn(buttonVariants(), "h-11 rounded-2xl font-extrabold")}>
            Go to scan
          </Link>
        </Surface>
      )}
    </Page>
  );
}
