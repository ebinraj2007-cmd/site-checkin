// Job types and the rules shared by server and phone. No database access here.

export type JobStatus = "assigned" | "arrived" | "completed" | "cancelled";
export type PhotoKind = "arrival" | "work" | "leave";

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
  status: JobStatus;
  arrived_at: Date | null;
  left_at: Date | null;
  completed_at: Date | null;
  notes: string;
  signature_name: string;
  signature_file: string | null;
  signed_at: Date | null;
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
  user_name?: string | null;
};

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

// Steps still needed before the job can be finished, given the current visit's photos
// (the leaving photo is the finishing step itself, so it is not listed here).
export function missingSteps(
  job: Pick<Job, "require_work_photos" | "require_notes" | "notes" | "require_signature" | "signature_file">,
  photos: Pick<JobPhoto, "kind">[],
): string[] {
  const missing: string[] = [];
  if (job.require_work_photos && !photos.some((p) => p.kind === "work")) missing.push("work photos");
  if (job.require_notes && !job.notes.trim()) missing.push("notes");
  if (job.require_signature && !job.signature_file) missing.push("customer signature");
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
