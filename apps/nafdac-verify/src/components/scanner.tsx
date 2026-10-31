"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, Flag, Keyboard, Loader2, RotateCcw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckResults } from "@/components/check-results";
import {
  api,
  ApiError,
  assetUrl,
  EMPTY_FIELDS,
  FIELD_LABELS,
  postJson,
  saveDraft,
  type CheckResult,
  type LabelFields,
  type ScanResponse,
} from "@/lib/api";

type Step = "start" | "reading" | "fields" | "checking" | "results";

export function Scanner() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("start");
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fields, setFields] = useState<LabelFields>(EMPTY_FIELDS);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("start");
    setScan(null);
    setPreview(null);
    setFields(EMPTY_FIELDS);
    setResult(null);
    setError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setPreview(URL.createObjectURL(file));
    setStep("reading");
    const form = new FormData();
    form.append("image", file);
    try {
      const response = await api<ScanResponse>("/api/scans", { method: "POST", body: form });
      setScan(response);
      setFields(response.fields ?? EMPTY_FIELDS);
      if (response.aiError) setError(response.aiError);
      setStep("fields");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
      setStep("start");
    }
  }

  async function onCheck(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStep("checking");
    try {
      // The confirmed fields become the training label for this photo.
      if (scan) await api(`/api/scans/${scan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
      setResult(await postJson<CheckResult>("/api/check", { fields }));
      setStep("results");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Check failed.");
      setStep("fields");
    }
  }

  function report() {
    saveDraft({ fields, scanId: scan?.id ?? null });
    router.push("/report");
  }

  const hasAnyField = Object.values(fields).some(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Check a medicine against NAFDAC alerts</h1>
        <p className="mt-1 text-muted-foreground">
          Photograph the pack. We read the batch number, registration number and maker, then compare them with every
          official NAFDAC recall and safety alert.
        </p>
      </section>

      {step === "start" && (
        <Card>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              id="photo"
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
            <Button size="lg" className="h-12 flex-1" onClick={() => fileInput.current?.click()}>
              <Camera /> Take or upload a photo
            </Button>
            <Button size="lg" variant="outline" className="h-12" onClick={() => setStep("fields")}>
              <Keyboard /> Type details instead
            </Button>
          </CardContent>
        </Card>
      )}

      {preview && step !== "start" && (
        <div className="overflow-hidden rounded-xl border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={scan ? assetUrl(scan.imageUrl) : preview} alt="Your product photo" className="mx-auto max-h-72 object-contain" />
        </div>
      )}

      {step === "reading" && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading the label with Gemma…
        </p>
      )}

      {error && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}

      {(step === "fields" || step === "checking") && (
        <Card>
          <CardHeader>
            <CardTitle>Check the details</CardTitle>
            <CardDescription>
              {scan?.fields
                ? "Read from your photo. Correct anything that doesn't match the pack. Your corrections help train the reader."
                : "Copy what is printed on the pack. Leave blank what you can't find."}
            </CardDescription>
            {scan?.notes && <p className="text-sm text-amber-700">Note from the reader: {scan.notes}</p>}
          </CardHeader>
          <CardContent>
            <form onSubmit={onCheck} className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(FIELD_LABELS) as (keyof LabelFields)[]).map((key) => (
                <label key={key} className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">{FIELD_LABELS[key]}</span>
                  <Input
                    value={fields[key] ?? ""}
                    onChange={(e) => setFields({ ...fields, [key]: e.target.value || null })}
                    className={key === "batchNumber" || key === "registrationNumber" ? "font-mono" : undefined}
                  />
                </label>
              ))}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" size="lg" className="h-11 flex-1" disabled={!hasAnyField || step === "checking"}>
                  {step === "checking" ? <Loader2 className="animate-spin" /> : <Search />} Check against NAFDAC
                </Button>
                <Button type="button" size="lg" variant="ghost" className="h-11" onClick={reset}>
                  <RotateCcw /> Start over
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {step === "results" && result && (
        <>
          <CheckResults result={result} fields={fields} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="h-11 flex-1" onClick={report}>
              <Flag /> Report this product
            </Button>
            <Button size="lg" variant="outline" className="h-11" onClick={() => setStep("fields")}>
              Edit details
            </Button>
            <Button size="lg" variant="ghost" className="h-11" onClick={reset}>
              <RotateCcw /> New scan
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
