// Job types and the rules shared by server and phone. No database access here.

export type JobStatus = "assigned" | "arrived" | "completed" | "cancelled";
export type PhotoKind = "arrival" | "work" | "leave";
// A manager's review of a photo or of skipped steps. "none": nothing to review.
export type ReviewState = "none" | "pending" | "approved" | "rejected";

export type Job = {
  id: string;
  title: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  instructions: string;
  site_lat: number;
  site_lng: number;
  radius_m: number;
  scheduled_at: Date | null;
  assigned_to: string | null;
  worker_name: string | null;
  worker_phone: string | null;
  require_leave_photo: boolean;
  require_work_photos: boolean;
  require_notes: boolean;
  require_signature: boolean;
  require_selfie: boolean;
  require_customer_code: boolean;
  // Never sent to the worker's phone: the customer gives it to them at the site.
  customer_code: string | null;
  code_confirmed_at: Date | null;
  code_attempts: number;
  pin_from_photo: boolean; // the manager moved the pin to where a check-in photo was taken
  status: JobStatus;
  arrived_at: Date | null;
  left_at: Date | null;
  completed_at: Date | null;
  notes: string;
  signature_name: string;
  signature_file: string | null;
  signed_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
};

export type JobPhoto = {
  id: string;
  job_id: string;
  user_id: string | null;
  kind: PhotoKind;
  file_key: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  distance_m: number | null;
  on_site: boolean;
  live_camera: boolean;
  device_time: Date | null;
  created_at: Date;
  altitude_m: number | null;
  altitude_accuracy_m: number | null;
  heading_deg: number | null;
  speed_mps: number | null;
  fix_time: Date | null;
  sha256: string | null;
  selfie_key: string | null;
  browser_id: string | null;
  ip_country: string | null;
  flags: Flag[];
  review: ReviewState;
  request_reason: RequestReason | null;
  request_note: string;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string;
  user_name?: string | null;
  reviewer_name?: string | null;
};

// Why a worker sends an arrival or leaving photo for approval instead of checking in.
export const REQUEST_REASONS = {
  gps_wrong: "My phone shows the wrong location",
  pin_wrong: "The job pin is in the wrong place",
  site_bigger: "The site is bigger than the circle",
  no_gps: "No GPS signal here (indoors, basement)",
  other: "Something else",
} as const;
export type RequestReason = keyof typeof REQUEST_REASONS;
export const isRequestReason = (v: unknown): v is RequestReason => typeof v === "string" && hasKey(REQUEST_REASONS, v);

// Steps a worker can skip with a reason when the customer can't do them. The manager
// reviews the skip.
export type SkipStep = "signature" | "code";
export const SKIP_STEP_LABEL: Record<SkipStep, string> = { signature: "customer signature", code: "customer code" };
export const SKIP_REASONS = {
  customer_absent: "The customer isn't here",
  customer_refused: "The customer won't do it",
  no_code: "The customer doesn't have the code",
  other: "Something else",
} as const;
export type SkipReason = keyof typeof SKIP_REASONS;
export const isSkipReason = (v: unknown): v is SkipReason => typeof v === "string" && hasKey(SKIP_REASONS, v);
export type JobSkip = {
  id: string;
  job_id: string;
  user_id: string | null;
  step: SkipStep;
  reason: SkipReason;
  note: string;
  created_at: Date;
  review: Exclude<ReviewState, "none">;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string;
  user_name?: string | null;
  reviewer_name?: string | null;
};

// Warning signs the server looks for in each photo (see fraud.ts). Strong ones send the
// photo to the manager's review; the rest are shown on the photo for them to weigh.
export const FLAGS = {
  duplicate_photo: { label: "Same photo sent before", strong: true },
  similar_photo: { label: "Looks like an earlier photo", strong: true },
  blank_photo: { label: "Photo is dark or blank", strong: true },
  at_pin: { label: "GPS exactly on the job pin", strong: true },
  impossible_travel: { label: "Too far from the last check-in", strong: true },
  shared_phone: { label: "Phone used by someone else", strong: true },
  same_point: { label: "Same GPS point as before", strong: false },
  moving_fast: { label: "Moving fast", strong: false },
  perfect_accuracy: { label: "GPS unusually precise", strong: false },
  stale_fix: { label: "Old GPS reading", strong: false },
  ip_country: { label: "Internet from another country", strong: false },
} as const;
export type FlagCode = keyof typeof FLAGS;
// `jobId`: the other job involved, if any (e.g. where the same photo was sent before).
export type Flag = { code: FlagCode; detail: string; jobId?: string };
export const isStrongFlag = (flag: Pick<Flag, "code">) => FLAGS[flag.code]?.strong ?? false;

// A photo counts (for check-in times and required steps) unless it waits for review or
// was rejected. Photos from before reviews existed have review "none".
export function photoCounts(photo: Pick<JobPhoto, "review">): boolean {
  return photo.review === "none" || photo.review === "approved";
}

// Wrong customer codes allowed per visit before the worker must skip the step instead.
export const CODE_MAX_ATTEMPTS = 5;

// A step skipped in this visit and not refused by the manager (yet).
export function isSkipped(skips: Pick<JobSkip, "step" | "review">[], step: SkipStep): boolean {
  return skips.some((s) => s.step === step && s.review !== "rejected");
}

export const LATE_AFTER_MINUTES = 15;

// Work photos per visit. Enough for before/after shots, not enough to fill the storage.
export const MAX_WORK_PHOTOS = 20;

// Arrival and leaving photos must be sent soon after they are taken, so the time the
// server records for them is a time the worker was really at the site.
export const PHOTO_MAX_AGE_MINUTES = 15;
const CLOCK_AHEAD_MINUTES = 10;

// Why an arrival or leaving photo taken at `takenAt` (the phone's clock) is refused, or null.
export function photoTimeProblem(takenAt: Date | null, now: Date): string | null {
  if (!takenAt) return "The photo's time is missing. Reload the app and take the photo again.";
  const age = now.getTime() - takenAt.getTime();
  if (age > PHOTO_MAX_AGE_MINUTES * 60_000) {
    return `This photo was taken more than ${PHOTO_MAX_AGE_MINUTES} minutes ago, or your phone's clock is wrong. Take a new photo at the site.`;
  }
  if (age < -CLOCK_AHEAD_MINUTES * 60_000) {
    return "Your phone's clock is ahead. Set the date and time to automatic, then take the photo again.";
  }
  return null;
}

// Reopening a job starts a new visit: it needs a new arrival photo, and the earlier
// photos stay on record without counting towards it. A visit's photos are the ones sent
// since its arrival photo (which shares the job's arrived_at timestamp).
export function isCurrentVisit(job: Pick<Job, "arrived_at">, photo: Pick<JobPhoto, "created_at">): boolean {
  return !!job.arrived_at && photo.created_at.getTime() >= job.arrived_at.getTime();
}

function hasKey(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

export type StepsJob = Pick<
  Job,
  | "require_work_photos"
  | "require_notes"
  | "notes"
  | "require_signature"
  | "signature_file"
  | "require_customer_code"
  | "code_confirmed_at"
>;

// Steps still needed before the job can be finished, given the current visit's photos and
// skips (the leaving photo is the finishing step itself, so it is not listed here). A work
// photo waiting for review counts for now, so a wrongly flagged photo never blocks the
// worker; a rejected one doesn't. A customer step skipped with a reason counts unless the
// manager rejected the skip.
export function missingSteps(
  job: StepsJob,
  photos: Pick<JobPhoto, "kind" | "review">[],
  skips: Pick<JobSkip, "step" | "review">[] = [],
): string[] {
  const missing: string[] = [];
  if (job.require_work_photos && !photos.some((p) => p.kind === "work" && p.review !== "rejected")) {
    missing.push("work photos");
  }
  if (job.require_notes && !job.notes.trim()) missing.push("notes");
  if (job.require_customer_code && !job.code_confirmed_at && !isSkipped(skips, "code")) missing.push("customer code");
  if (job.require_signature && !job.signature_file && !isSkipped(skips, "signature")) missing.push("customer signature");
  return missing;
}

export function isLate(job: Pick<Job, "status" | "scheduled_at">, now = new Date()): boolean {
  return (
    job.status === "assigned" &&
    !!job.scheduled_at &&
    now.getTime() > job.scheduled_at.getTime() + LATE_AFTER_MINUTES * 60_000
  );
}

export function statusLabel(status: JobStatus): string {
  return { assigned: "Not started", arrived: "On site", completed: "Done", cancelled: "Cancelled" }[status];
}
