"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { Camera, Check, ImagePlus, Keyboard, Loader2, SwitchCamera, X } from "lucide-react";
import { api, ApiError, type ScanResponse } from "@/lib/api";
import { runReader, type ReaderStep } from "@/lib/reader";
import { setScannerOpen, useScannerOpen } from "@/lib/scanner";
import { emptySession, sessionStore, type ScanSession } from "@/lib/stores";
import { cn } from "@/lib/utils";
import { PRIMARY_ACTION } from "./ui";

type CameraState = "starting" | "live" | "unavailable";
type Facing = "environment" | "user";

const ICON_BUTTON =
  "flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-field border border-line bg-surface text-ink transition-colors hover:bg-sunken disabled:pointer-events-none disabled:opacity-40 has-focus-visible:ring-2 has-focus-visible:ring-blue";

/** Camera, upload and progress. The dialog unmounts it once closed, which stops the camera. */
function Scanner({ busy, setBusy }: { busy: boolean; setBusy: (busy: boolean) => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [camera, setCamera] = useState<CameraState>("starting");
  const [steps, setSteps] = useState<ReaderStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
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
  }, [facing]);

  const finish = useCallback(
    (session: ScanSession) => {
      sessionStore.set(session);
      setScannerOpen(false);
      setBusy(false);
      router.push("/review", { transitionTypes: ["nav-forward"] });
    },
    [router, setBusy],
  );

  async function read(image: Blob) {
    setBusy(true);
    setSteps([]);
    setError(null);
    const form = new FormData();
    form.append("image", image, "pack.jpg");
    let uploaded: ScanResponse;
    try {
      uploaded = await api<ScanResponse>("/api/scans", { method: "POST", body: form });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Upload failed. Try again.");
      setBusy(false);
      return;
    }
    let session: ScanSession = {
      ...emptySession(),
      scanId: uploaded.id,
      imageUrl: uploaded.imageUrl,
      aiError: uploaded.aiAvailable ? null : uploaded.aiError,
    };
    // Without the AI reader the user types the details in on the review screen.
    if (uploaded.aiAvailable) {
      session = await runReader(`/api/scans/${uploaded.id}/verify`, {}, session, setSteps);
    }
    finish(session);
  }

  async function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (image) await read(image);
    else setError("We couldn't capture that frame. Try uploading a photo.");
  }

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void read(file);
  }

  return (
    <>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-ink">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-hidden
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-300",
            camera === "live" ? "opacity-100" : "opacity-0",
            facing === "user" && "-scale-x-100",
          )}
        />
        {camera === "live" ? (
          <span aria-hidden className="absolute inset-5 rounded-field border border-white/50" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/70">
            {camera === "starting" ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <Camera className="size-6" aria-hidden />}
            {camera === "starting" ? "Starting camera" : "No camera access. Take or upload a photo instead."}
          </div>
        )}
        {busy ? <div aria-hidden className="absolute inset-0 bg-ink/50" /> : null}
      </div>

      {busy ? (
        <ol role="status" aria-live="polite" className="flex min-h-12 flex-col gap-2 px-1">
          {steps.length === 0 ? (
            <li className="flex items-center gap-2.5 text-sm font-medium">
              <Loader2 className="size-4 animate-spin text-blue" aria-hidden /> Uploading photo…
            </li>
          ) : null}
          {steps.map((step, index) => (
            <li key={index} className={cn("flex items-start gap-2.5 text-sm", step.done ? "text-ink-muted" : "font-medium")}>
              {step.done ? (
                <Check className="mt-0.5 size-4 shrink-0 text-safe" aria-hidden />
              ) : (
                <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-blue" aria-hidden />
              )}
              {step.message}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center gap-3">
          <label className={ICON_BUTTON} aria-label="Upload a photo">
            <ImagePlus className="size-5" aria-hidden />
            <input type="file" accept="image/*" onChange={choosePhoto} className="sr-only" />
          </label>
          {camera === "unavailable" ? (
            <label className={cn(PRIMARY_ACTION, "flex-1 cursor-pointer")}>
              <Camera aria-hidden /> Take a photo
              <input type="file" accept="image/*" capture="environment" onChange={choosePhoto} className="sr-only" />
            </label>
          ) : (
            <button type="button" onClick={() => void capture()} disabled={camera !== "live"} className={cn(PRIMARY_ACTION, "flex-1")}>
              <Camera aria-hidden /> Take photo
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setCamera("starting");
              setFacing((current) => (current === "environment" ? "user" : "environment"));
            }}
            disabled={camera === "unavailable"}
            aria-label="Switch camera"
            className={ICON_BUTTON}
          >
            <SwitchCamera className="size-5" aria-hidden />
          </button>
        </div>
      )}

      {error ? (
        <p role="alert" className="rounded-field bg-danger-tint px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {busy ? null : (
        <button
          type="button"
          onClick={() => finish(emptySession())}
          className="flex h-10 items-center justify-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink"
        >
          <Keyboard className="size-4" aria-hidden /> Type the details instead
        </button>
      )}
    </>
  );
}

export function ScannerSheet() {
  const open = useScannerOpen();
  const [busy, setBusy] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Closing mid-read would drop the scan, so the sheet stays until the reader finishes.
        if (!next && busy) return;
        setScannerOpen(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px] transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[440px] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] outline-none transition-[translate,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[ending-style]:translate-y-8 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-8 data-[starting-style]:opacity-0 motion-reduce:transition-none">
          <div className="flex flex-col gap-4 rounded-sheet bg-surface p-4 shadow-raised">
            <span aria-hidden className="mx-auto -mt-1 h-1 w-10 rounded-full bg-line" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <Dialog.Title className="text-lg font-semibold tracking-tight">Scan a medicine</Dialog.Title>
                <Dialog.Description className="text-sm text-ink-muted">
                  Fit the front of the pack inside the frame.
                </Dialog.Description>
              </div>
              <Dialog.Close
                disabled={busy}
                aria-label="Close"
                className="flex size-9 shrink-0 items-center justify-center rounded-field bg-sunken text-ink-muted hover:text-ink disabled:opacity-40"
              >
                <X className="size-[18px]" aria-hidden />
              </Dialog.Close>
            </div>
            <Scanner busy={busy} setBusy={setBusy} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Any "scan" entry point: opens the scanner sheet over the current page. */
export function ScanButton({ className, children, label }: { className?: string; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" onClick={() => setScannerOpen(true)} aria-label={label} className={className}>
      {children}
    </button>
  );
}
