"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Lock, Send, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Notice, Page, PageHeader, PRIMARY_ACTION, Section, Surface } from "@/components/app/ui";
import { api, ApiError, DRAFT_KEY, EMPTY_FIELDS, FIELD_LABELS, loadDraft, type LabelFields } from "@/lib/api";
import { useClientValue } from "@/lib/use-client-value";
import { cn } from "@/lib/utils";

const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT (Abuja)", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
  "Sokoto", "Taraba", "Yobe", "Zamfara",
];

const FIELD = "h-11 rounded-field border-line bg-surface px-3 text-[15px] shadow-none";
const LABEL = "text-xs font-medium text-ink-muted";

export function ReportForm() {
  const router = useRouter();
  const [fields, setFields] = useState<LabelFields>(EMPTY_FIELDS);
  const [scanId, setScanId] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [purchasePlace, setPurchasePlace] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the scan once the browser value is available (adjust-state-during-render pattern).
  const draftRaw = useClientValue(() => sessionStorage.getItem(DRAFT_KEY) ?? "");
  const [appliedDraft, setAppliedDraft] = useState("");
  if (draftRaw !== appliedDraft) {
    setAppliedDraft(draftRaw);
    const draft = loadDraft();
    if (draft) {
      setFields(draft.fields);
      setScanId(draft.scanId);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData();
    form.append(
      "report",
      JSON.stringify({
        fields,
        description,
        state,
        lga: lga || null,
        purchasePlace: purchasePlace || null,
        purchaseDate: purchaseDate || null,
        contact: contact || null,
        scanId,
        consent,
      }),
    );
    photos.forEach((photo) => form.append("photos", photo));
    try {
      const { id, receiptToken } = await api<{ id: string; receiptToken: string }>("/api/reports", { method: "POST", body: form });
      router.push(`/receipt?id=${id}&token=${receiptToken}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not send the report.");
      setSubmitting(false);
    }
  }

  return (
    <Page>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <PageHeader
          back={{ href: "/", label: "Back to home" }}
          title="Report a product"
          subtitle="Reviewers group reports about the same product and batch, then prepare them as evidence for NAFDAC. Nothing you send is published."
        />

        <Section title="Product">
          <Surface className="flex flex-col gap-3 p-4">
            <p className="text-sm text-ink-muted">{scanId ? "Filled in from your scan." : "Copy what is printed on the pack."}</p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(FIELD_LABELS) as (keyof LabelFields)[]).map((key) => (
                <label key={key} className={cn("flex flex-col gap-1.5", key === "productName" && "col-span-2")}>
                  <span className={LABEL}>{FIELD_LABELS[key]}</span>
                  <Input
                    value={fields[key] ?? ""}
                    onChange={(e) => setFields({ ...fields, [key]: e.target.value || null })}
                    className={cn(FIELD, (key === "batchNumber" || key === "registrationNumber") && "font-mono")}
                  />
                </label>
              ))}
            </div>
          </Surface>
        </Section>

        <Section title="What happened">
          <Surface className="flex flex-col gap-4 p-4">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Describe the problem *</span>
              <Textarea
                required
                minLength={10}
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. The packaging looks different from before, the tablets crumble, it had no effect…"
                className="rounded-field border-line px-3 py-2.5 text-[15px] shadow-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex flex-col gap-1.5">
                <span className={LABEL}>State where you bought it *</span>
                <select
                  required
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  className="h-11 rounded-field border border-line bg-surface px-3 text-[15px] outline-none focus-visible:border-blue focus-visible:ring-3 focus-visible:ring-blue/15"
                >
                  <option value="">Choose a state</option>
                  {STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>LGA / area</span>
                <Input value={lga} onChange={(e) => setLga(e.target.value)} className={FIELD} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Date bought</span>
                <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className={FIELD} />
              </label>
              <label className="col-span-2 flex flex-col gap-1.5">
                <span className={LABEL}>Where you bought it</span>
                <Input value={purchasePlace} onChange={(e) => setPurchasePlace(e.target.value)} placeholder="Pharmacy, market, vendor…" className={FIELD} />
              </label>
            </div>
          </Surface>
        </Section>

        <Section title="Photos">
          <label className="flex cursor-pointer items-center gap-3 rounded-card border border-dashed border-line bg-surface p-4 has-focus-visible:ring-2 has-focus-visible:ring-blue">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-blue-tint text-blue-strong">
              <ImagePlus className="size-5" aria-hidden />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""} added` : "Add up to 4 photos"}</span>
              <span className="text-xs text-ink-muted">Pack, batch number and receipt. Location data is removed.</span>
            </span>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 4))}
              className="sr-only"
            />
          </label>
        </Section>

        <Section title="Contact (optional)">
          <Surface className="flex flex-col gap-1.5 p-4">
            <Input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Phone or email" className={FIELD} />
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Lock className="size-3" aria-hidden /> Only reviewers see this.
            </span>
          </Surface>
        </Section>

        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            required
            className="mt-1 size-4 shrink-0 accent-blue"
          />
          <span>
            I agree that Medfify reviewers may read this report and pass it, with the photos, to NAFDAC. I understand it does
            not publicly label the product as fake.
          </span>
        </label>

        {error ? (
          <Notice tone="danger" icon={TriangleAlert}>
            <span role="alert">{error}</span>
          </Notice>
        ) : null}

        <button type="submit" disabled={submitting || !consent} className={PRIMARY_ACTION}>
          {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Send report
        </button>
      </form>
    </Page>
  );
}
