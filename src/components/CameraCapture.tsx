"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkOnSite, formatDistance, type LatLng } from "@/lib/geo";
import type { PhotoKind } from "@/lib/job-rules";
import { formatStamp } from "@/lib/time";
import { buttonClass } from "./ui";

type Fix = { lat: number; lng: number; accuracy: number; at: number };
type Shot = { blob: Blob; url: string; fix: Fix | null; live: boolean; takenAt: Date };

const KIND_LABEL: Record<PhotoKind, string> = { arrival: "ARRIVED", work: "WORK PHOTO", leave: "LEFT SITE" };
const TITLE: Record<PhotoKind, string> = { arrival: "Arrival photo", work: "Work photo", leave: "Leaving photo" };
const MAX_SIDE = 1600;

// Full-screen camera for proof photos. Uses the live camera (no gallery) and the
// phone's GPS; arrival and leaving photos can only be taken inside the check-in
// circle. The time, GPS and job are burned into the picture before upload.
export function CameraCapture({
  jobId,
  jobTitle,
  kind,
  site,
  radius,
  workerName,
  timezone,
  onClose,
  onDone,
}: {
  jobId: string;
  jobTitle: string;
  kind: PhotoKind;
  site: LatLng;
  radius: number;
  workerName: string;
  timezone: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const requireOnSite = kind === "arrival" || kind === "leave";
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<"starting" | "live" | "failed">("starting");
  const [fix, setFix] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Camera on while the viewfinder is showing. A stream that arrives after the
  // viewfinder closed (e.g. Cancel during the permission prompt) is stopped at once.
  useEffect(() => {
    if (shot) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
        setCamera("live");
      } catch {
        if (!cancelled) setCamera("failed");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [shot, stopCamera]);

  // GPS the whole time; keep the most accurate reading from the last 20 seconds.
  useEffect(() => {
    if (!navigator.geolocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGpsError("This browser can't share its location.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const next: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          at: Date.now(),
        };
        setGpsError(null);
        setFix((prev) => (prev && next.at - prev.at < 20_000 && prev.accuracy < next.accuracy ? prev : next));
      },
      (err) => {
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked. Allow location for this app in your phone settings, then try again."
            : "Can't get your location yet. Make sure location (GPS) is on.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Free the preview image when it's replaced or the camera closes.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  const check = fix ? checkOnSite({ ...site, radius }, fix) : null;
  const canShoot = !requireOnSite || (check?.ok ?? false);

  async function makeShot(source: CanvasImageSource, width: number, height: number, live: boolean) {
    const takenAt = new Date();
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0, w, h);
    const place = fix
      ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)} (±${Math.round(fix.accuracy)} m) · ${formatDistance(check!.distance)} from site`
      : "Location not available";
    stamp(ctx, w, h, [`${KIND_LABEL[kind]} · ${jobTitle}`, `${formatStamp(takenAt, timezone)} · ${workerName}`, place]);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob) throw new Error("Couldn't save the photo.");
    setShot({ blob, url: URL.createObjectURL(blob), fix, live, takenAt });
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setError(null);
    await makeShot(video, video.videoWidth, video.videoHeight, true);
    stopCamera();
  }

  // Fallback when the browser won't open the live camera: the phone's own camera app.
  async function fromFile(file: File) {
    setError(null);
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return setError("That photo couldn't be read. Try again.");
    await makeShot(bitmap, bitmap.width, bitmap.height, false);
    bitmap.close();
  }

  async function upload() {
    if (!shot) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.set("kind", kind);
    form.set("photo", shot.blob, "photo.jpg");
    form.set("live", shot.live ? "1" : "0");
    form.set("deviceTime", shot.takenAt.toISOString());
    if (shot.fix) {
      form.set("lat", String(shot.fix.lat));
      form.set("lng", String(shot.fix.lng));
      form.set("accuracy", String(shot.fix.accuracy));
    }
    try {
      const res = await fetch(`/api/jobs/${jobId}/photo`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      onDone();
    } catch (e) {
      const offline = e instanceof TypeError;
      setError(offline ? "No internet connection. Your photo is kept; tap Send again when you have signal." : (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label={TITLE[kind]}>
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">
          Cancel
        </button>
        <p className="font-semibold">{TITLE[kind]}</p>
        <span className="w-16" />
      </div>

      <div className="relative min-h-0 flex-1">
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview blob
          <img src={shot.url} alt="Your photo" className="h-full w-full object-contain" />
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
            {camera === "starting" && <p className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Opening camera…</p>}
            {camera === "failed" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <p className="text-sm text-white/80">
                  The camera didn&apos;t open here. Allow camera access, or use your phone&apos;s camera instead.
                </p>
                <button
                  type="button"
                  disabled={!canShoot}
                  onClick={() => fileRef.current?.click()}
                  className={buttonClass("primary")}
                >
                  Open phone camera
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) fromFile(file);
                  }}
                />
              </div>
            )}
          </>
        )}
        <GpsChip
          fix={shot ? shot.fix : fix}
          check={shot?.fix ? checkOnSite({ ...site, radius }, shot.fix) : check}
          requireOnSite={requireOnSite}
          error={shot ? null : gpsError}
        />
      </div>

      <div className="space-y-3 px-4 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {error && <p className="rounded-xl bg-red-500/90 px-3 py-2 text-sm font-medium">{error}</p>}
        {shot ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => {
                setCamera("starting");
                setShot(null);
                setError(null);
              }}
              className={buttonClass("secondary", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20")}
            >
              Retake
            </button>
            <button type="button" disabled={uploading} onClick={upload} className={buttonClass("primary", "lg")}>
              {uploading ? "Sending…" : "Send photo"}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center">
            <button
              type="button"
              aria-label="Take photo"
              disabled={camera !== "live" || !canShoot}
              onClick={shoot}
              className="h-18 w-18 rounded-full border-4 border-white bg-white/90 shadow-lg transition active:scale-95 disabled:opacity-30"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function GpsChip({
  fix,
  check,
  requireOnSite,
  error,
}: {
  fix: Fix | null;
  check: ReturnType<typeof checkOnSite> | null;
  requireOnSite: boolean;
  error: string | null;
}) {
  let tone = "bg-black/60";
  let text: string;
  if (error) {
    tone = "bg-red-600/90";
    text = error;
  } else if (!fix || !check) {
    text = "Finding your location…";
  } else if (check.ok) {
    tone = "bg-emerald-600/90";
    text = `✓ At the site · ${formatDistance(check.distance)} away (GPS ±${Math.round(fix.accuracy)} m)`;
  } else if (requireOnSite) {
    tone = "bg-red-600/90";
    text = check.reason === "weak-gps" ? check.message : `${formatDistance(check.distance)} from the site. Move closer to take the photo.`;
  } else {
    text = `${formatDistance(check.distance)} from the site`;
  }
  return (
    <p
      data-testid="gps-status"
      className={`absolute top-3 left-1/2 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-xl px-3 py-2 text-center text-sm font-semibold ${tone}`}
    >
      {text}
    </p>
  );
}

// Dark strip along the bottom with white text, like a GPS camera app.
function stamp(ctx: CanvasRenderingContext2D, w: number, h: number, lines: string[]) {
  const size = Math.max(14, Math.round(w * 0.026));
  const pad = Math.round(size * 0.7);
  const lineHeight = Math.round(size * 1.35);
  const boxHeight = lines.length * lineHeight + pad * 2;
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  ctx.fillRect(0, h - boxHeight, w, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 700 : 500} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(line, pad, h - boxHeight + pad + i * lineHeight, w - pad * 2);
  });
}
