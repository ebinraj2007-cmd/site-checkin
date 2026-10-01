"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkOnSite, formatDistance, type LatLng } from "@/lib/geo";
import { REQUEST_REASONS, type PhotoKind, type RequestReason, type ReviewState } from "@/lib/job-rules";
import { formatStamp } from "@/lib/time";
import { buttonClass, inputClass } from "./ui";

type Fix = {
  lat: number;
  lng: number;
  accuracy: number;
  at: number; // when this page got it
  time: number; // when the phone made it
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
};
type Shot = { blob: Blob; url: string; fix: Fix | null; live: boolean; takenAt: Date };
type Request = { reason: RequestReason; note: string };
export type CaptureResult = { conflict?: string; review?: ReviewState };

const KIND_LABEL: Record<PhotoKind, string> = { arrival: "ARRIVED", work: "WORK PHOTO", leave: "LEFT SITE" };
const TITLE: Record<PhotoKind, string> = { arrival: "Arrival photo", work: "Work photo", leave: "Leaving photo" };
const MAX_SIDE = 1600;
const SELFIE_MAX_SIDE = 720;
// A GPS reading older than this doesn't count: the phone may have moved since.
const FIX_MAX_AGE = 60_000;
// A photo from the phone's own camera app must be this fresh (see photoTimeProblem).
const FILE_MAX_AGE = 15 * 60_000;

// Full-screen camera for proof photos. Uses the live camera (no gallery) and the
// phone's GPS; arrival and leaving photos can only be taken inside the check-in
// circle, or sent to the manager for approval with a reason. Jobs can ask for a selfie
// too (front camera, after the main photo). The time, GPS and job are burned into the
// picture before upload. `onDone` gets the server's reason when the job changed in the
// meantime, and whether the photo waits for the manager's review.
export function CameraCapture({
  jobId,
  jobTitle,
  kind,
  site,
  radius,
  workerName,
  timezone,
  requireSelfie = false,
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
  requireSelfie?: boolean;
  onClose: () => void;
  onDone: (result: CaptureResult) => void;
}) {
  const requireOnSite = kind === "arrival" || kind === "leave";
  const needSelfie = requireSelfie && requireOnSite;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState<"starting" | "live" | "failed">("starting");
  const [fix, setFix] = useState<Fix | null>(null);
  const [now, setNow] = useState(0); // ticks while the camera is open; 0 until the first tick
  const [waited, setWaited] = useState(false); // long enough to offer "send for approval"
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [selfie, setSelfie] = useState<Shot | null>(null);
  const [request, setRequest] = useState<Request | null>(null);
  const [asking, setAsking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which camera is showing: the back one for the photo, then the front one for a selfie.
  const facing = !shot ? "environment" : needSelfie && !selfie ? "user" : null;

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Camera on while a viewfinder is showing. A stream that arrives after the viewfinder
  // closed (e.g. Cancel during the permission prompt) is stopped at once.
  useEffect(() => {
    if (!facing) return;
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video:
            facing === "user"
              ? { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } }
              : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
          // play() can resolve before the first frame; the shutter waits for a picture.
          if (!(await firstFrame(video))) {
            if (!cancelled) {
              stopCamera();
              setCamera("failed");
            }
            return;
          }
        }
        if (!cancelled) setCamera("live");
      } catch {
        if (!cancelled) setCamera("failed");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [facing, stopCamera]);

  // GPS the whole time; keep the most accurate reading from the last 20 seconds.
  useEffect(() => {
    if (!navigator.geolocation) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGpsError("This browser can't share its location.");
      return;
    }
    let last = 0;
    const accept = (pos: GeolocationPosition) => {
      last = Date.now();
      const c = pos.coords;
      const next: Fix = {
        lat: c.latitude,
        lng: c.longitude,
        accuracy: c.accuracy,
        at: last,
        time: pos.timestamp,
        altitude: c.altitude,
        altitudeAccuracy: c.altitudeAccuracy,
        heading: c.heading,
        speed: c.speed,
      };
      setGpsError(null);
      setFix((prev) => (prev && next.at - prev.at < 20_000 && prev.accuracy < next.accuracy ? prev : next));
    };
    const failed = (err: GeolocationPositionError) => {
      setGpsError(
        err.code === err.PERMISSION_DENIED
          ? "Location is blocked. Allow location for this app in your phone settings, then try again."
          : "Can't get your location yet. Make sure location (GPS) is on.",
      );
    };
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 };
    const id = navigator.geolocation.watchPosition(accept, failed, options);
    // Some phones stop reporting while standing still; ask again so the reading stays fresh.
    let asked = false;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (asked || Date.now() - last < 15_000) return;
      asked = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          asked = false;
          accept(pos);
        },
        () => {
          asked = false;
        },
        options,
      );
    }, 5000);
    const offer = setTimeout(() => setWaited(true), 15_000);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(timer);
      clearTimeout(offer);
    };
  }, []);

  // Free the preview images when they're replaced or the camera closes.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);
  useEffect(() => {
    return () => {
      if (selfie) URL.revokeObjectURL(selfie.url);
    };
  }, [selfie]);

  const liveFix = fix && (now === 0 || now - fix.at < FIX_MAX_AGE) ? fix : null;
  const check = liveFix ? checkOnSite({ ...site, radius }, liveFix) : null;
  const atSite = check?.ok ?? false;
  const canShoot = !requireOnSite || atSite || !!request || !!shot;
  // Offer the way out once it's clear the normal check-in isn't working here.
  const offerRequest = requireOnSite && !atSite && !request && !shot && (!!gpsError || (check && !check.ok) || waited);

  async function makeShot(source: CanvasImageSource, width: number, height: number, live: boolean) {
    const takenAt = new Date();
    const canvas = scaled(source, width, height, MAX_SIDE);
    const place = liveFix
      ? `${liveFix.lat.toFixed(5)}, ${liveFix.lng.toFixed(5)} (±${Math.round(liveFix.accuracy)} m) · ${formatDistance(check!.distance)} from site`
      : "Location not available";
    const lines = [`${KIND_LABEL[kind]} · ${jobTitle}`, `${formatStamp(takenAt, timezone)} · ${workerName}`, place];
    if (request && !atSite) lines.push(`SENT FOR APPROVAL · ${REQUEST_REASONS[request.reason]}`);
    stamp(canvas, lines);
    const blob = await jpeg(canvas, 0.82);
    setShot({ blob, url: URL.createObjectURL(blob), fix: liveFix, live, takenAt });
    if (needSelfie) setCamera("starting");
  }

  async function makeSelfie(source: CanvasImageSource, width: number, height: number, live: boolean) {
    const takenAt = new Date();
    const canvas = scaled(source, width, height, SELFIE_MAX_SIDE);
    stamp(canvas, [`SELFIE · ${workerName}`, formatStamp(takenAt, timezone)]);
    const blob = await jpeg(canvas, 0.8);
    setSelfie({ blob, url: URL.createObjectURL(blob), fix: null, live, takenAt });
  }

  async function shoot() {
    const video = videoRef.current;
    if (!video || !(await firstFrame(video))) {
      setError("The camera isn't ready yet. Try again in a moment.");
      return;
    }
    setError(null);
    const make = shot ? makeSelfie : makeShot;
    await make(video, video.videoWidth, video.videoHeight, true);
    stopCamera();
  }

  // Fallback when the browser won't open the live camera: the phone's own camera app.
  async function fromFile(file: File) {
    setError(null);
    if (await takenEarlier(file)) return setError("This photo was taken earlier. Take a new one now.");
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return setError("That photo couldn't be read. Try again.");
    const make = shot ? makeSelfie : makeShot;
    await make(bitmap, bitmap.width, bitmap.height, false);
    bitmap.close();
  }

  function retake() {
    setCamera("starting");
    setShot(null);
    setSelfie(null);
    setError(null);
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
    if (selfie) form.set("selfie", selfie.blob, "selfie.jpg");
    if (request) {
      form.set("request", request.reason);
      form.set("requestNote", request.note);
    }
    const f = shot.fix;
    if (f) {
      form.set("lat", String(f.lat));
      form.set("lng", String(f.lng));
      form.set("accuracy", String(f.accuracy));
      form.set("fixTime", new Date(f.time).toISOString());
      for (const [key, value] of Object.entries({
        altitude: f.altitude,
        altitudeAccuracy: f.altitudeAccuracy,
        heading: f.heading,
        speed: f.speed,
      })) {
        if (value !== null && Number.isFinite(value)) form.set(key, String(value));
      }
    }
    try {
      const res = await fetch(`/api/jobs/${jobId}/photo`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      // The job was cancelled, moved to someone else, or already moved on: reload it.
      if (res.status === 409 || res.status === 404) return onDone({ conflict: data.error ?? "This job changed in the meantime." });
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      onDone({ review: data.review });
    } catch (e) {
      const offline = e instanceof TypeError;
      setError(offline ? "No internet connection. Your photo is kept; tap Send again when you have signal." : (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const ready = !!shot && (!needSelfie || !!selfie);
  const shotCheck = shot?.fix ? checkOnSite({ ...site, radius }, shot.fix) : null;
  const shotAtSite = shotCheck?.ok ?? false;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white" role="dialog" aria-label={TITLE[kind]}>
      <div className="flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        <button type="button" onClick={onClose} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">
          Cancel
        </button>
        <p className="font-semibold">{facing === "user" ? "Now a selfie" : TITLE[kind]}</p>
        <span className="w-16" />
      </div>

      <div className="relative min-h-0 flex-1">
        {ready ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- local preview blob */}
            <img src={shot.url} alt="Your photo" className="h-full w-full object-contain" />
            {selfie && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview blob
              <img
                src={selfie.url}
                alt="Your selfie"
                className="absolute right-3 bottom-3 h-32 w-24 rounded-xl border-2 border-white object-cover shadow-lg"
              />
            )}
          </>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
            />
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
                  {facing === "user" ? "Open phone camera for the selfie" : "Open phone camera"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture={facing === "user" ? "user" : "environment"}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) fromFile(file);
                  }}
                />
              </div>
            )}
            {shot && (
              // eslint-disable-next-line @next/next/no-img-element -- local preview blob
              <img
                src={shot.url}
                alt="Your photo"
                className="absolute bottom-3 left-3 h-24 w-32 rounded-xl border-2 border-white object-cover shadow-lg"
              />
            )}
          </>
        )}
        {facing !== "user" && (
          <GpsChip
            fix={shot ? shot.fix : liveFix}
            check={shot ? shotCheck : check}
            requireOnSite={requireOnSite}
            request={request}
            error={shot ? null : gpsError}
          />
        )}
        {asking && (
          <RequestSheet
            onCancel={() => setAsking(false)}
            onChoose={(r) => {
              setRequest(r);
              setAsking(false);
            }}
          />
        )}
      </div>

      <div className="space-y-3 px-4 pt-4 pb-[max(env(safe-area-inset-bottom),1rem)]">
        {error && <p className="rounded-xl bg-red-500/90 px-3 py-2 text-sm font-medium">{error}</p>}
        {ready ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={retake}
              className={buttonClass("secondary", "lg", "border-white/30 bg-white/10 text-white hover:bg-white/20")}
            >
              Retake
            </button>
            <button type="button" disabled={uploading} onClick={upload} className={buttonClass("primary", "lg")}>
              {uploading ? "Sending…" : request && !shotAtSite ? "Send for approval" : "Send photo"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              aria-label={facing === "user" ? "Take selfie" : "Take photo"}
              disabled={camera !== "live" || !canShoot}
              onClick={shoot}
              className="h-18 w-18 rounded-full border-4 border-white bg-white/90 shadow-lg transition active:scale-95 disabled:opacity-30"
            />
            {offerRequest && (
              <button type="button" onClick={() => setAsking(true)} className="text-sm font-semibold text-white underline">
                Can&apos;t check in here? Send for approval
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// "Can't check in here?": the worker says why, then takes the photo for the manager.
function RequestSheet({ onCancel, onChoose }: { onCancel: () => void; onChoose: (r: Request) => void }) {
  const [reason, setReason] = useState<RequestReason | null>(null);
  const [note, setNote] = useState("");
  const noteNeeded = reason === "other" && note.trim().length < 3;
  return (
    <div className="absolute inset-0 z-10 flex items-end bg-black/60" role="dialog" aria-label="Send for approval">
      <div className="max-h-full w-full space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 text-slate-900">
        <h2 className="text-lg font-bold">Send for approval</h2>
        <p className="text-sm text-slate-600">
          Your manager checks the photo and where it was taken. It counts once they approve it, so carry on with the job.
        </p>
        <fieldset className="space-y-2">
          <legend className="sr-only">Why can&apos;t you check in?</legend>
          {(Object.entries(REQUEST_REASONS) as [RequestReason, string][]).map(([key, label]) => (
            <label key={key} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-medium">
              <input
                type="radio"
                name="request-reason"
                checked={reason === key}
                onChange={() => setReason(key)}
                className="h-5 w-5 accent-brand-700"
              />
              {label}
            </label>
          ))}
        </fieldset>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={300}
          aria-label="Note for your manager"
          placeholder={reason === "other" ? "What's wrong? (needed)" : "Anything to add? (optional)"}
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className={buttonClass("secondary", "lg")}>
            Back
          </button>
          <button
            type="button"
            disabled={!reason || noteNeeded}
            onClick={() => reason && onChoose({ reason, note: note.trim() })}
            className={buttonClass("primary", "lg")}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// True once the video has a frame to capture; false if none comes within 5 seconds.
async function firstFrame(video: HTMLVideoElement): Promise<boolean> {
  for (let waited = 0; waited <= 5000; waited += 100) {
    if (video.videoWidth > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

function scaled(source: CanvasImageSource, width: number, height: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function jpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("Couldn't save the photo.");
  return blob;
}

// A picture from the phone's camera app that wasn't taken just now (picked from the
// gallery), judged by the time in the photo itself, or else the file's date.
async function takenEarlier(file: File): Promise<boolean> {
  const taken = (await exifTakenAt(file)) ?? (file.lastModified > 0 ? file.lastModified : null);
  return taken !== null && Date.now() - taken > FILE_MAX_AGE;
}

// EXIF DateTimeOriginal of a JPEG, read as the phone's local time; null if there is none.
async function exifTakenAt(file: File): Promise<number | null> {
  try {
    const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (view.getUint16(0) !== 0xffd8) return null;
    let at = 2;
    while (at + 4 <= view.byteLength) {
      const marker = view.getUint16(at);
      const size = view.getUint16(at + 2);
      // APP1 holding "Exif", then a TIFF header.
      if (marker === 0xffe1 && view.getUint32(at + 4) === 0x45786966) {
        const tiff = at + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const u16 = (o: number) => view.getUint16(tiff + o, little);
        const u32 = (o: number) => view.getUint32(tiff + o, little);
        const findTag = (ifd: number, tag: number) => {
          const count = u16(ifd);
          for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (u16(entry) === tag) return entry;
          }
          return null;
        };
        const exifPointer = findTag(u32(4), 0x8769);
        if (exifPointer === null) return null;
        const original = findTag(u32(exifPointer + 8), 0x9003);
        if (original === null) return null;
        const offset = u32(original + 8);
        const text = Array.from({ length: 19 }, (_, i) => String.fromCharCode(view.getUint8(tiff + offset + i))).join("");
        const m = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      at += 2 + size;
    }
  } catch {
    // Unreadable: fall back to the file's date.
  }
  return null;
}

function GpsChip({
  fix,
  check,
  requireOnSite,
  request,
  error,
}: {
  fix: Fix | null;
  check: ReturnType<typeof checkOnSite> | null;
  requireOnSite: boolean;
  request: Request | null;
  error: string | null;
}) {
  let tone = "bg-black/60";
  let text: string;
  if (request && !check?.ok) {
    tone = "bg-amber-600/95";
    text = `For approval: ${REQUEST_REASONS[request.reason]}${check ? ` · ${formatDistance(check.distance)} from the site` : ""}`;
  } else if (error) {
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
function stamp(canvas: HTMLCanvasElement, lines: string[]) {
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
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
