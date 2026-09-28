"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { formatDistance, type LatLng } from "@/lib/geo";
import { MAX_WORK_PHOTOS, missingSteps, type JobStatus, type PhotoKind } from "@/lib/job-rules";
import { CameraCapture } from "./CameraCapture";
import { SignaturePad } from "./SignaturePad";
import { Alert, buttonClass, inputClass } from "./ui";

export type StepJob = {
  id: string;
  title: string;
  status: JobStatus;
  site: LatLng;
  radius: number;
  requireWorkPhotos: boolean;
  requireNotes: boolean;
  requireSignature: boolean;
  requireLeavePhoto: boolean;
  notes: string;
  signatureName: string;
  signatureUrl: string | null;
  signedAtText: string | null;
  arrivedAtText: string | null;
  completedAtText: string | null;
};

export type StepPhoto = {
  id: string;
  kind: PhotoKind;
  url: string;
  timeText: string;
  distance: number | null;
  onSite: boolean;
};

// The worker's job screen: arrival photo → (work photos, notes, signature) → finish.
// `photos` are the current visit's (a reopened job starts over with a new arrival photo).
export function JobSteps({
  job,
  photos,
  workerName,
  timezone,
}: {
  job: StepJob;
  photos: StepPhoto[];
  workerName: string;
  timezone: string;
}) {
  const router = useRouter();
  const [camera, setCamera] = useState<PhotoKind | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: "green" | "amber" } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const arrival = photos.findLast((p) => p.kind === "arrival");
  const leave = photos.findLast((p) => p.kind === "leave");
  const work = photos.filter((p) => p.kind === "work");
  const onSite = job.status === "arrived";
  const missing = missingSteps(
    {
      require_work_photos: job.requireWorkPhotos,
      require_notes: job.requireNotes,
      notes: job.notes,
      require_signature: job.requireSignature,
      signature_file: job.signatureUrl,
    },
    photos,
  );

  // After a step is saved, or when the server says the job changed in the meantime
  // (cancelled, moved, or already done from another tap): show why and reload the job.
  function done(message: string, tone: "green" | "amber" = "green") {
    setCamera(null);
    setFlash({ text: message, tone });
    setError(null);
    router.refresh();
  }
  const conflict = (message: string) => done(message, "amber");

  async function finish() {
    setFinishing(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/finish`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 404) return conflict(data.error ?? "This job changed in the meantime.");
      if (!res.ok) throw new Error(data.error ?? "Couldn't finish the job.");
      done("Job finished. Good work!");
    } catch (e) {
      setError(e instanceof TypeError ? "No internet connection. Try again when you have signal." : (e as Error).message);
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="space-y-3">
      {flash && <Alert tone={flash.tone}>{flash.text}</Alert>}
      {job.status === "cancelled" && <Alert tone="red">This job was cancelled. You don&apos;t need to go.</Alert>}

      <Step
        n={1}
        title="Arrival photo"
        done={!!arrival}
        detail={
          arrival
            ? `${arrival.timeText}${arrival.distance !== null ? ` · ${formatDistance(arrival.distance)} from site` : ""}`
            : `When you reach the site, take a photo. It only works within ${formatDistance(job.radius)} of the job pin.`
        }
      >
        {arrival ? (
          <Thumb photo={arrival} />
        ) : (
          job.status === "assigned" && (
            <button type="button" onClick={() => setCamera("arrival")} className={buttonClass("primary", "lg")}>
              <CameraIcon /> I&apos;m here: take arrival photo
            </button>
          )
        )}
      </Step>

      {(onSite || job.status === "completed") && (
        <>
          {(job.requireWorkPhotos || work.length > 0 || onSite) && (
            <Step
              n={2}
              title="Work photos"
              badge={job.requireWorkPhotos ? "required" : "optional"}
              done={work.length > 0}
              detail={work.length ? `${work.length} photo${work.length === 1 ? "" : "s"}` : "Photos of the work, e.g. before and after."}
            >
              {work.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {work.map((p) => (
                    <Thumb key={p.id} photo={p} small />
                  ))}
                </div>
              )}
              {onSite &&
                (work.length < MAX_WORK_PHOTOS ? (
                  <button type="button" onClick={() => setCamera("work")} className={buttonClass("secondary", "md", "w-full")}>
                    <CameraIcon /> Add work photo
                  </button>
                ) : (
                  <p className="text-sm text-slate-500">{MAX_WORK_PHOTOS} photos is the most a visit can have.</p>
                ))}
            </Step>
          )}

          {(job.requireNotes || job.notes || onSite) && (
            <Step
              n={3}
              title="Notes"
              badge={job.requireNotes ? "required" : "optional"}
              done={!!job.notes.trim()}
              detail={onSite ? "What was done, parts used, anything the office should know." : undefined}
            >
              {onSite ? (
                <NotesBox jobId={job.id} initial={job.notes} onSaved={() => done("Notes saved.")} onConflict={conflict} />
              ) : (
                <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{job.notes}</p>
              )}
            </Step>
          )}

          {job.requireSignature && (
            <Step
              n={4}
              title="Customer signature"
              badge="required"
              done={!!job.signatureUrl}
              detail={job.signatureUrl ? `Signed by ${job.signatureName}${job.signedAtText ? ` · ${job.signedAtText}` : ""}` : "Hand the phone to the customer."}
            >
              {job.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image
                <img src={job.signatureUrl} alt="Customer signature" className="h-24 w-full rounded-xl border border-slate-200 bg-white object-contain" />
              ) : (
                onSite && <SignaturePad jobId={job.id} onSaved={() => done("Signature saved.")} onConflict={conflict} />
              )}
            </Step>
          )}

          <Step
            n={5}
            title={job.requireLeavePhoto ? "Leaving photo" : "Finish"}
            done={job.status === "completed"}
            detail={
              job.status === "completed"
                ? `Finished ${job.completedAtText ?? ""}`
                : missing.length
                  ? `Still needed: ${missing.join(", ")}.`
                  : job.requireLeavePhoto
                    ? "Take a photo at the site as you leave. This finishes the job."
                    : "Everything's done. Tap finish."
            }
          >
            {leave && <Thumb photo={leave} />}
            {onSite &&
              (job.requireLeavePhoto ? (
                <button
                  type="button"
                  disabled={missing.length > 0}
                  onClick={() => setCamera("leave")}
                  className={buttonClass("primary", "lg")}
                >
                  <CameraIcon /> Take leaving photo &amp; finish
                </button>
              ) : (
                <button type="button" disabled={missing.length > 0 || finishing} onClick={finish} className={buttonClass("primary", "lg")}>
                  {finishing ? "Finishing…" : "✓ Finish job"}
                </button>
              ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </Step>
        </>
      )}

      {camera && (
        <CameraCapture
          jobId={job.id}
          jobTitle={job.title}
          kind={camera}
          site={job.site}
          radius={job.radius}
          workerName={workerName}
          timezone={timezone}
          onClose={() => setCamera(null)}
          onDone={(changed) =>
            changed
              ? conflict(changed)
              : done(
                  camera === "arrival"
                    ? "Arrival recorded. Your manager can see it."
                    : camera === "leave"
                      ? "Job finished. Good work!"
                      : "Photo added.",
                )
          }
        />
      )}
    </div>
  );
}

function Step({
  n,
  title,
  badge,
  done,
  detail,
  children,
}: {
  n: number;
  title: string;
  badge?: string;
  done: boolean;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-600"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900">
            {title}
            {badge && <span className="ml-2 text-xs font-medium text-slate-500">{badge}</span>}
          </h2>
          {detail && <p className="text-sm text-slate-600">{detail}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Thumb({ photo, small = false }: { photo: StepPhoto; small?: boolean }) {
  return (
    <a href={photo.url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-xl bg-slate-900">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
      <img src={photo.url} alt={`${photo.kind} photo`} className={`w-full ${small ? "aspect-square object-cover" : "max-h-72 object-contain"}`} />
    </a>
  );
}

function NotesBox({
  jobId,
  initial,
  onSaved,
  onConflict,
}: {
  jobId: string;
  initial: string;
  onSaved: () => void;
  onConflict: (message: string) => void;
}) {
  const [notes, setNotes] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = notes.trim() !== initial.trim();

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 404) return onConflict(data.error ?? "This job changed in the meantime.");
      if (!res.ok) throw new Error(data.error ?? "Saving failed.");
      onSaved();
    } catch (e) {
      setError(e instanceof TypeError ? "No internet connection. Try again when you have signal." : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        maxLength={4000}
        aria-label="Notes"
        placeholder="e.g. Replaced filter, cleaned coils. Customer asked for a quote on the second unit."
        className={inputClass}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="button" onClick={save} disabled={saving || !dirty} className={buttonClass("secondary", "md", "w-full")}>
        {saving ? "Saving…" : dirty ? "Save notes" : "Saved"}
      </button>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}
