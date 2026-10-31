"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Camera, ChevronLeft, FileText, FlaskConical, Hash, ImagePlus, Loader2, X } from "lucide-react";
import { DEMO_PACKS, extractWithConfidence, type PackSource } from "@/lib/extract";
import { sessionStore } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { FlowTransition } from "./ui";

type Mode = "auto" | "manual";
type CameraState = "starting" | "live" | "unavailable";

// Long enough for the user to steady the pack, short enough to feel automatic.
const AUTO_CAPTURE_MS = 2800;

const LOOK_FOR = [
  { icon: Hash, label: "Reg. number" },
  { icon: FileText, label: "Medicine name" },
  { icon: CalendarDays, label: "Expiry date" },
] as const;

const CORNERS = [
  "top-3 left-3 rounded-tl-lg border-t-[3px] border-l-[3px]",
  "top-3 right-3 rounded-tr-lg border-t-[3px] border-r-[3px]",
  "bottom-3 left-3 rounded-bl-lg border-b-[3px] border-l-[3px]",
  "right-3 bottom-3 rounded-br-lg border-r-[3px] border-b-[3px]",
] as const;

const SIDE_BUTTON =
  "flex w-[72px] cursor-pointer flex-col items-center gap-2 text-xs font-semibold text-white/85 has-focus-visible:ring-2 has-focus-visible:ring-white";
const SIDE_ICON = "flex size-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white";

export function ScanFlow() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>("auto");
  const [camera, setCamera] = useState<CameraState>("starting");
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unsupported");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }
        setCamera("live");
      } catch (failure) {
        console.warn("Camera unavailable, falling back to photo upload", failure);
        if (!cancelled) setCamera("unavailable");
      }
    }

    void start();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const read = useCallback(
    async (source: PackSource) => {
      setBusy(true);
      setError(null);
      try {
        const { label, lowConfidence } = await extractWithConfidence(source);
        sessionStore.set({ source: source.kind, label, lowConfidence });
        router.push("/review", { transitionTypes: ["nav-forward"] });
      } catch (failure) {
        console.error("Reading the label failed", failure);
        setError("We couldn't read that pack. Try again or use a demo pack.");
        setBusy(false);
      }
    },
    [router],
  );

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("We couldn't capture that frame. Try the upload button.");
      return;
    }
    context.drawImage(video, 0, 0);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!image) {
      setError("We couldn't capture that frame. Try the upload button.");
      return;
    }
    await read({ kind: "photo", image });
  }, [read]);

  const autoArmed = mode === "auto" && camera === "live" && !busy && !sheetOpen;
  useEffect(() => {
    if (!autoArmed) return;
    const timer = window.setTimeout(() => void capture(), AUTO_CAPTURE_MS);
    return () => window.clearTimeout(timer);
  }, [autoArmed, capture]);

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void read({ kind: "photo", image: file });
  }

  const status =
    camera === "starting"
      ? "Starting camera…"
      : camera === "unavailable"
        ? "Camera unavailable. Take or upload a photo instead."
        : mode === "auto"
          ? "Hold steady. We capture automatically."
          : "Line up the label, then tap the shutter.";

  return (
    <FlowTransition>
      <main className="fixed inset-0 z-20 mx-auto flex w-full max-w-[430px] flex-col overflow-hidden bg-[#0a1424] text-white">
        <section className="relative flex flex-1 items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            muted
            playsInline
            aria-hidden
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-500",
              camera === "live" ? "opacity-100" : "opacity-0",
            )}
          />

          <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-14">
            <Link
              href="/"
              transitionTypes={["nav-back"]}
              aria-label="Back to home"
              className="flex size-11 items-center justify-center rounded-full bg-[#0a1424]/70 text-white"
            >
              <ChevronLeft className="size-[22px]" aria-hidden />
            </Link>
            <h1 className="rounded-full bg-[#0a1424]/70 px-4 py-2 text-sm font-semibold">Scan label</h1>
            <div className="size-11" aria-hidden />
          </header>

          <div className="relative aspect-[4/3] w-[86%] rounded-[22px] shadow-[0_0_0_999px_rgba(10,20,36,0.66)]">
            <span aria-hidden className="absolute inset-0 rounded-[22px] border border-white/25" />
            {CORNERS.map((corner) => (
              <span key={corner} aria-hidden className={cn("absolute size-7 border-white", corner)} />
            ))}
            {camera === "live" && mode === "auto" ? (
              <span aria-hidden className="scan-sweep absolute inset-x-4 h-px bg-scan shadow-[0_0_14px_2px_rgba(245,207,63,0.55)]" />
            ) : null}
          </div>
        </section>

        <footer className="relative z-10 flex flex-col gap-5 rounded-t-[28px] border-t border-white/10 bg-[#0a1424] px-6 pt-5 pb-9">
          <div
            role="group"
            aria-label="Scan mode"
            className="mx-auto grid w-full max-w-[260px] grid-cols-2 rounded-full bg-white/10 p-1"
          >
            {(["auto", "manual"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "h-10 rounded-full text-sm font-semibold transition-colors duration-300",
                  mode === option ? "bg-white text-[#0a1424]" : "text-white/80",
                )}
              >
                {option === "auto" ? "Auto scan" : "Manual"}
              </button>
            ))}
          </div>

          <div className="flex flex-col items-center gap-3">
            <p role="status" className="text-center text-sm text-white/85">
              {status}
            </p>
            <ul className="flex flex-wrap justify-center gap-2" aria-label="What we look for">
              {LOOK_FOR.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80">
                  <Icon className="size-3.5" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          {error ? (
            <p role="alert" className="rounded-2xl bg-coral-tint px-4 py-3 text-[13px] font-semibold text-coral">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-between">
            <label htmlFor="upload" className={SIDE_BUTTON}>
              <span className={SIDE_ICON}>
                <ImagePlus className="size-5" aria-hidden />
              </span>
              Upload
              <input id="upload" type="file" accept="image/*" onChange={choosePhoto} className="sr-only" />
            </label>

            <div className="relative flex size-[92px] items-center justify-center">
              <svg viewBox="0 0 92 92" aria-hidden className="absolute inset-0 -rotate-90">
                <circle cx="46" cy="46" r="42" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="3" />
                {autoArmed ? (
                  <circle
                    cx="46"
                    cy="46"
                    r="42"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="3"
                    strokeLinecap="round"
                    style={{ "--auto-ms": `${AUTO_CAPTURE_MS}ms` } as React.CSSProperties}
                    className="scan-ring"
                  />
                ) : null}
              </svg>
              {camera === "unavailable" ? (
                <label
                  htmlFor="capture"
                  className="flex size-[72px] cursor-pointer items-center justify-center rounded-full bg-white text-[#0a1424] has-focus-visible:ring-2 has-focus-visible:ring-white"
                >
                  <Camera className="size-7" aria-hidden />
                  <span className="sr-only">Take photo</span>
                  <input
                    id="capture"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={choosePhoto}
                    className="sr-only"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  aria-label="Capture now"
                  disabled={camera !== "live" || busy}
                  onClick={() => void capture()}
                  className="size-[72px] rounded-full bg-white shadow-[inset_0_0_0_4px_#0a1424,inset_0_0_0_5px_rgba(14,26,43,0.15)] disabled:opacity-50"
                />
              )}
            </div>

            <button type="button" onClick={() => setSheetOpen(true)} className={SIDE_BUTTON}>
              <span className={SIDE_ICON}>
                <FlaskConical className="size-5" aria-hidden />
              </span>
              Demo pack
            </button>
          </div>
        </footer>

        {busy ? (
          <div role="status" className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#0a1424]/80">
            <Loader2 className="size-9 animate-spin" aria-hidden />
            <span className="text-[15px] font-semibold">Reading label…</span>
          </div>
        ) : null}

        {sheetOpen ? (
          <div className="absolute inset-0 z-40 flex flex-col justify-end">
            <button
              type="button"
              aria-label="Close demo packs"
              onClick={() => setSheetOpen(false)}
              className="absolute inset-0 bg-black/55"
            />
            <section
              id="demo"
              aria-label="Demo packs"
              className="relative flex flex-col gap-3 rounded-t-[28px] bg-canvas p-5 pb-8 text-ink"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Demo pack</h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setSheetOpen(false)}
                  className="flex size-11 items-center justify-center rounded-full border border-line bg-white"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <p className="text-[13px] text-ink-muted">No pack to hand? Use a sample label.</p>
              {DEMO_PACKS.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSheetOpen(false);
                    void read({ kind: "demo", id: pack.id });
                  }}
                  className="flex items-center gap-3 rounded-card border border-line bg-white p-3.5 text-left shadow-card"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-forest-tint text-forest">
                    <FlaskConical className="size-5" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-bold">{pack.title}</span>
                    <span className="text-xs text-ink-muted">
                      <span className="font-mono font-semibold">{pack.id}</span> · {pack.hint}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          </div>
        ) : null}
      </main>
    </FlowTransition>
  );
}
