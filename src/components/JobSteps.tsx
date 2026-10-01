"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { formatDistance, type LatLng } from "@/lib/geo";
import {
  MAX_WORK_PHOTOS,
  missingSteps,
  REQUEST_REASONS,
  SKIP_REASONS,
  SKIP_STEP_LABEL,
  type JobStatus,
  type PhotoKind,
  type RequestReason,
  type ReviewState,
  type SkipReason,
  type SkipStep,
} from "@/lib/job-rules";
import { CameraCapture, type CaptureResult } from "./CameraCapture";
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
  requireSelfie: boolean;
  requireCustomerCode: boolean;
  codeConfirmed: boolean;
  codeTriesLeft: number;
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
  review: ReviewState;
  requestReason: RequestReason | null;
  reviewNote: string;
};

// A customer step skipped with a reason in this visit, and what the manager made of it.
export type StepSkip = {
  id: string;
  step: SkipStep;
  reason: SkipReason;
  note: string;
  review: Exclude<ReviewState, "none">;
  reviewNote: string;
};

type StepState = "todo" | "done" | "waiting" | "rejected";

// The worker's job screen: arrival photo → (work photos, notes, customer code, signature)
// → finish. `photos` are the current visit's (a reopened job starts over with a new
// arrival photo). `alert`: something the worker must know first (e.g. their arrival photo
// was rejected).
export function JobSteps({
  job,
  photos,
  skips,
  workerName,
  timezone,
  alert,
}: {
  job: StepJob;
  photos: StepPhoto[];
  skips: StepSkip[];
  workerName: string;
  timezone: string;
  alert?: string | null;
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
  const stepsJob = {
    require_work_photos: job.requireWorkPhotos,
    require_notes: job.requireNotes,
    notes: job.notes,
    require_signature: job.requireSignature,
    signature_file: job.signatureUrl,
    require_customer_code: job.requireCustomerCode,
    code_confirmed_at: job.codeConfirmed ? new Date(0) : null,
  };
  const missing = missingSteps(stepsJob, photos, skips);
  // The skip that stands for a step (waiting or approved), and a refused one still to sort out.
  const skipFor = (step: SkipStep) => skips.findLast((s) => s.step === step && s.review !== "rejected");
  const refused = onSite
    ? skips.findLast((s) => s.review === "rejected" && !skipFor(s.step) && missing.includes(SKIP_STEP_LABEL[s.step]))
    : undefined;
  let n = 0;

  // After a step is saved, or when the server says the job changed in the meantime
  // (cancelled, moved, or already done from another tap): show why and reload the job.
  function done(message: string, tone: "green" | "amber" = "green") {
    setCamera(null);
    setFlash({ text: message, tone });
    setError(null);
    router.refresh();
  }
  const conflict = (message: string) => done(message, "amber");

  function captured(kind: PhotoKind, result: CaptureResult) {
    if (result.conflict) return conflict(result.conflict);
    const review = result.review === "pending";
    const text =
      kind === "arrival"
        ? review
          ? "Arrival sent. Your manager will check it; carry on with the job."
          : "Arrival recorded. Your manager can see it."
        : kind === "leave"
          ? review
            ? "Job finished. Your manager will check your leaving photo."
            : "Job finished. Good work!"
          : review
            ? "Photo added. Your manager will check it."
            : "Photo added.";
    done(text, review ? "amber" : "green");
  }

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
      {alert && <Alert tone="red">{alert}</Alert>}
      {job.status === "cancelled" && <Alert tone="red">This job was cancelled. You don&apos;t need to go.</Alert>}
      {refused && (
        <Alert tone="red">
          Your manager didn&apos;t accept skipping the {SKIP_STEP_LABEL[refused.step]}
          {refused.reviewNote ? `: “${refused.reviewNote}”` : ""}. Get it before you finish, or skip it again with a better
          reason.
        </Alert>
      )}

      <Step
        n={++n}
        title="Arrival photo"
        state={photoState(arrival)}
        detail={
          arrival
            ? [arrival.timeText, arrival.distance !== null ? `${formatDistance(arrival.distance)} from site` : null, reviewText(arrival)]
                .filter(Boolean)
                .join(" · ")
            : `When you reach the site, take a photo${job.requireSelfie ? " and a selfie" : ""}. It only works within ${formatDistance(job.radius)} of the job pin.`
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
              n={++n}
              title="Work photos"
              badge={job.requireWorkPhotos ? "required" : "optional"}
              state={work.some((p) => p.review !== "rejected") ? "done" : "todo"}
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
              n={++n}
              title="Notes"
              badge={job.requireNotes ? "required" : "optional"}
              state={job.notes.trim() ? "done" : "todo"}
              detail={onSite ? "What was done, parts used, anything the office should know." : undefined}
            >
              {onSite ? (
                <NotesBox jobId={job.id} initial={job.notes} onSaved={() => done("Notes saved.")} onConflict={conflict} />
              ) : (
                <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{job.notes}</p>
              )}
            </Step>
          )}

          {job.requireCustomerCode && (
            <Step
              n={++n}
              title="Customer code"
              badge="required"
              state={job.codeConfirmed ? "done" : skipFor("code") ? skipState(skipFor("code")!) : "todo"}
              detail={
                job.codeConfirmed
                  ? "The customer gave the code."
                  : skipFor("code")
                    ? skippedText(skipFor("code")!)
                    : "When the work is done, ask the customer for their 4-digit code."
              }
            >
              {!job.codeConfirmed && !skipFor("code") && onSite && (
                <>
                  <CodeBox jobId={job.id} triesLeft={job.codeTriesLeft} onSaved={() => done("Customer code confirmed.")} onConflict={conflict} />
                  <SkipStepBox
                    jobId={job.id}
                    step="code"
                    onSaved={() => done("Skipped. Your manager will check it.", "amber")}
                    onConflict={conflict}
                  />
                </>
              )}
            </Step>
          )}

          {job.requireSignature && (
            <Step
              n={++n}
              title="Customer signature"
              badge="required"
              state={job.signatureUrl ? "done" : skipFor("signature") ? skipState(skipFor("signature")!) : "todo"}
              detail={
                job.signatureUrl
                  ? `Signed by ${job.signatureName}${job.signedAtText ? ` · ${job.signedAtText}` : ""}`
                  : skipFor("signature")
                    ? skippedText(skipFor("signature")!)
                    : "Hand the phone to the customer."
              }
            >
              {job.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image
                <img src={job.signatureUrl} alt="Customer signature" className="h-24 w-full rounded-xl border border-slate-200 bg-white object-contain" />
              ) : (
                onSite &&
                !skipFor("signature") && (
                  <>
                    <SignaturePad jobId={job.id} onSaved={() => done("Signature saved.")} onConflict={conflict} />
                    <SkipStepBox
                      jobId={job.id}
                      step="signature"
                      onSaved={() => done("Skipped. Your manager will check it.", "amber")}
                      onConflict={conflict}
                    />
                  </>
                )
              )}
            </Step>
          )}

          <Step
            n={++n}
            title={job.requireLeavePhoto ? "Leaving photo" : "Finish"}
            state={job.status === "completed" ? (leave ? photoState(leave) : "done") : "todo"}
            detail={
              job.status === "completed"
                ? [`Finished ${job.completedAtText ?? ""}`, leave ? reviewText(leave) : null].filter(Boolean).join(" · ")
                : missing.length
                  ? `Still needed: ${missing.join(", ")}.`
                  : job.requireLeavePhoto
                    ? "Take a photo at the site as you leave. This finishes the job."
                    : "Everything's done. Tap finish."
            }
          >
            {leave && job.status === "completed" && <Thumb photo={leave} />}
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
          requireSelfie={job.requireSelfie}
          onClose={() => setCamera(null)}
          onDone={(result) => captured(camera, result)}
        />
      )}
    </div>
  );
}

function photoState(photo: StepPhoto | undefined): StepState {
  if (!photo) return "todo";
  return photo.review === "pending" ? "waiting" : photo.review === "rejected" ? "rejected" : "done";
}

// What the manager's review means for this photo, in the worker's words.
function reviewText(photo: StepPhoto): string | null {
  const asked = photo.requestReason ? `Sent for approval (${REQUEST_REASONS[photo.requestReason].toLowerCase()})` : null;
  const note = photo.reviewNote ? `: “${photo.reviewNote}”` : "";
  if (photo.review === "pending") return asked ? `${asked}, your manager will check it` : "Your manager will check this photo";
  if (photo.review === "approved") return `Approved by your manager${note}`;
  if (photo.review === "rejected") return `Not accepted by your manager${note}`;
  return null;
}

function skipState(skip: StepSkip): StepState {
  return skip.review === "approved" ? "done" : "waiting";
}

function skippedText(skip: StepSkip): string {
  const status = skip.review === "approved" ? "approved by your manager" : "your manager will check it";
  return `Skipped: ${SKIP_REASONS[skip.reason] ?? skip.reason}${skip.note ? ` (“${skip.note}”)` : ""} · ${status}`;
}

function Step({
  n,
  title,
  badge,
  state,
  detail,
  children,
}: {
  n: number;
  title: string;
  badge?: string;
  state: StepState;
  detail?: string;
  children?: ReactNode;
}) {
  const marks: Record<StepState, [string, string]> = {
    todo: [String(n), "bg-slate-200 text-slate-600"],
    done: ["✓", "bg-emerald-600 text-white"],
    waiting: ["…", "bg-amber-500 text-white"],
    rejected: ["✕", "bg-red-600 text-white"],
  };
  const [mark, tone] = marks[state];
  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${tone}`}>{mark}</span>
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
    <a href={photo.url} target="_blank" rel="noopener noreferrer" className="relative block overflow-hidden rounded-xl bg-slate-900">
      {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
      <img src={photo.url} alt={`${photo.kind} photo`} className={`w-full ${small ? "aspect-square object-cover" : "max-h-72 object-contain"}`} />
      {small && (photo.review === "pending" || photo.review === "rejected") && (
        <span
          className={`absolute top-1 left-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${
            photo.review === "pending" ? "bg-amber-500" : "bg-red-600"
          }`}
        >
          {photo.review === "pending" ? "Checking" : "Rejected"}
        </span>
      )}
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

// The code the customer gives the worker. Wrong codes use up the visit's few tries.
function CodeBox({
  jobId,
  triesLeft,
  onSaved,
  onConflict,
}: {
  jobId: string;
  triesLeft: number;
  onSaved: () => void;
  onConflict: (message: string) => void;
}) {
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      // Out of tries, or the job changed: reload to show what's next.
      if (res.status === 409 || res.status === 404 || res.status === 429 || data.left === 0) {
        return onConflict(data.error ?? "This job changed in the meantime.");
      }
      if (!res.ok) {
        setCode("");
        throw new Error(data.error ?? "Couldn't check the code.");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof TypeError ? "No internet connection. Try again when you have signal." : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (triesLeft <= 0) {
    return <p className="text-sm text-red-700">No tries left. If the customer can&apos;t give the code, skip this step below.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          aria-label="Customer code"
          placeholder="0000"
          className={`${inputClass} w-36 text-center font-mono text-xl tracking-[0.4em]`}
        />
        <button type="button" onClick={check} disabled={saving || code.length !== 4} className={buttonClass("primary", "md", "flex-1")}>
          {saving ? "Checking…" : "Check code"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// "The customer can't do this": skip the step with a reason for the manager to review.
function SkipStepBox({
  jobId,
  step,
  onSaved,
  onConflict,
}: {
  jobId: string;
  step: SkipStep;
  onSaved: () => void;
  onConflict: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SkipReason | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reasons = (Object.entries(SKIP_REASONS) as [SkipReason, string][]).filter(([key]) => key !== "no_code" || step === "code");

  async function skip() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step, reason, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 || res.status === 404) return onConflict(data.error ?? "This job changed in the meantime.");
      if (!res.ok) throw new Error(data.error ?? "Couldn't skip this step.");
      onSaved();
    } catch (e) {
      setError(e instanceof TypeError ? "No internet connection. Try again when you have signal." : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-slate-600 underline">
        Customer can&apos;t do this? Skip with a reason
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-950">Why are you skipping the {SKIP_STEP_LABEL[step]}?</p>
      <fieldset className="space-y-1.5">
        <legend className="sr-only">Reason</legend>
        {reasons.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`skip-${step}`}
              checked={reason === key}
              onChange={() => setReason(key)}
              className="h-4 w-4 accent-brand-700"
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
        placeholder={reason === "other" ? "What happened? (needed)" : "Anything to add? (optional)"}
        className={inputClass}
      />
      <p className="text-xs text-amber-900">Your manager is told and checks it. You can finish the job meanwhile.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
          Back
        </button>
        <button
          type="button"
          onClick={skip}
          disabled={saving || !reason || (reason === "other" && note.trim().length < 3)}
          className={buttonClass("primary", "md", "flex-1")}
        >
          {saving ? "Saving…" : "Skip and tell my manager"}
        </button>
      </div>
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
