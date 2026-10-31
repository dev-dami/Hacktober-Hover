"use client";

import { useState, type FormEvent } from "react";
import { ScanText, Upload, LoaderCircle } from "lucide-react";

type Word = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type Scan = { id: string; image: string; width: number; height: number; text: string; words: Word[] };

export function ImageScanner() {
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setError(""); setScan(null); setLoading(true);
    try {
      const body = new FormData(); body.append("image", file);
      const response = await fetch("/api/ocr", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Scan failed.");
      setScan(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed.");
    } finally { setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900 sm:py-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 flex items-center gap-3 text-emerald-800"><ScanText size={28} /><span className="font-bold tracking-tight">NAFDAC VERIFY <span className="font-normal text-slate-500">/ IMAGE SCAN</span></span></div>
        <div className="mb-8 max-w-2xl"><p className="mb-3 text-sm font-semibold uppercase tracking-widest text-emerald-700">Phase 1 · Text extraction</p><h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Read the label.</h1><p className="mt-4 text-lg leading-7 text-slate-600">Upload a clear photo of product packaging to detect text and its location. Review the results before using them.</p></div>
        <form onSubmit={submit} className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label htmlFor="image" className="mb-2 block text-sm font-semibold">Product photo</label>
          <p className="mb-4 text-sm text-slate-500">JPEG, PNG or WebP, up to 10 MB. The photo and automatic OCR boxes are saved on the server for later review.</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center"><input id="image" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required disabled={loading} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setScan(null); setError(""); }} className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-4 file:py-2.5 file:font-semibold file:text-emerald-800" /><button disabled={!file || loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-800 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-50">{loading ? <LoaderCircle className="animate-spin" size={17} /> : <Upload size={17} />}{loading ? "Reading image…" : "Scan image"}</button></div>
          {loading && <p role="status" className="mt-4 text-sm text-slate-500">The first scan may take longer while the OCR model downloads.</p>}
          {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
        </form>
        {scan && <section aria-label="Scan results" className="grid gap-6 lg:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-1 text-lg font-semibold">Detected text</h2><p className="mb-4 text-sm text-slate-500">Boxes mark individual words detected by OCR.</p><div className="relative inline-block w-full overflow-hidden rounded-lg bg-slate-100 leading-none">{/* The normalized image shares coordinates with OCR. */}<img src={scan.image} alt="Uploaded packaging with detected text boxes" className="block h-auto w-full" />{scan.words.map((word, index) => <span key={index} title={`${word.text} (${Math.round(word.confidence)}% confidence)`} className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-300/15" style={{ left: `${word.bbox.x0 / scan.width * 100}%`, top: `${word.bbox.y0 / scan.height * 100}%`, width: `${(word.bbox.x1 - word.bbox.x0) / scan.width * 100}%`, height: `${(word.bbox.y1 - word.bbox.y0) / scan.height * 100}%` }} />)}</div></div><div className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-semibold">Extracted text</h2><p className="mt-1 text-sm text-slate-500">{scan.words.length} words detected · Scan {scan.id}</p><pre className="mt-5 min-h-48 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 font-sans text-sm leading-7 text-slate-700">{scan.text.trim() || "No text detected. Try a sharper, well-lit photo."}</pre><p className="mt-4 text-sm text-slate-500">This is an unreviewed OCR result, not a product verification or proof of authenticity.</p></div></section>}
      </div>
    </main>
  );
}
