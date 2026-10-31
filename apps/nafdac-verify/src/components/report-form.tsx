"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, ApiError, DRAFT_KEY, EMPTY_FIELDS, FIELD_LABELS, loadDraft, type LabelFields } from "@/lib/api";
import { useClientValue } from "@/lib/use-client-value";

const STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT (Abuja)", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina",
  "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
  "Sokoto", "Taraba", "Yobe", "Zamfara",
];

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

  // Prefill from the scan page once the browser value is available (adjust-state-during-render pattern).
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
      setError(e instanceof ApiError ? e.message : "Could not submit the report.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Report a suspicious product</h1>
        <p className="mt-1 text-muted-foreground">
          Reports are reviewed and grouped with others about the same product and batch, then prepared as evidence for
          NAFDAC. Nothing you send is published.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product</CardTitle>
          <CardDescription>{scanId ? "Filled in from your scan." : "Copy what is printed on the pack."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(FIELD_LABELS) as (keyof LabelFields)[]).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{FIELD_LABELS[key]}</span>
              <Input value={fields[key] ?? ""} onChange={(e) => setFields({ ...fields, [key]: e.target.value || null })} />
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What happened</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Describe the problem *</span>
            <Textarea
              required
              minLength={10}
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. The packaging looks different from before, the tablets crumble, it had no effect…"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">State where you bought it *</span>
              <select
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                <option value="">Choose a state</option>
                {STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">LGA / area</span>
              <Input value={lga} onChange={(e) => setLga(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Where you bought it</span>
              <Input value={purchasePlace} onChange={(e) => setPurchasePlace(e.target.value)} placeholder="Pharmacy, market, vendor…" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">When you bought it</span>
              <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Photos of the pack, batch number and receipt (up to 4)</span>
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setPhotos(Array.from(e.target.files ?? []).slice(0, 4))}
            />
            <span className="text-xs text-muted-foreground">Location data is removed from photos before they are stored.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Phone or email (optional, only reviewers see it)</span>
            <Input value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" required />
            <span>
              I agree that SafeMeds NG reviewers may read this report and pass it, with the photos, to NAFDAC. I
              understand it does not publicly label the product as fake.
            </span>
          </label>
        </CardContent>
      </Card>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
      <Button type="submit" size="lg" className="h-11" disabled={submitting || !consent}>
        {submitting ? <Loader2 className="animate-spin" /> : <Send />} Submit report
      </Button>
    </form>
  );
}
