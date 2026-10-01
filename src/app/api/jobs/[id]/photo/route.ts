import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { apiWorker, fail, numberField, readBody } from "@/lib/api";
import { browserId } from "@/lib/auth";
import { notifyArrival, notifyFinished, notifyReview } from "@/lib/checkin-notify";
import { queryOne, transaction } from "@/lib/db";
import { findFlags } from "@/lib/fraud";
import { checkOnSite, isValidLatLng } from "@/lib/geo";
import { imageInfo } from "@/lib/image-check";
import {
  FLAGS,
  getJob,
  getJobPhotos,
  getJobSkips,
  isCurrentVisit,
  isRequestReason,
  isStrongFlag,
  MAX_WORK_PHOTOS,
  missingSteps,
  photoTimeProblem,
  REQUEST_REASONS,
  type ReviewState,
} from "@/lib/jobs";
import { countriesForCallingCode } from "@/lib/phone";
import { imagePrint, sha256Hex } from "@/lib/photo-hash";
import { getSettings } from "@/lib/settings";
import { putFile, StorageError } from "@/lib/storage";

// The app sends JPEGs of at most 1600 px, a few hundred KB each; selfies are smaller.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SELFIE_BYTES = 1024 * 1024;

// Arrival, work and leaving photos. The server re-checks the GPS reading against the
// job site; only arrival and leaving photos must be inside the check-in circle, and
// only fresh ones count (the server's clock is what goes on record). A worker who can't
// check in there (wrong pin, no GPS indoors…) can send the photo for the manager to
// approve instead. Every photo is checked for warning signs (see fraud.ts); strong ones
// also send it to the manager's review.
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/photo">) {
  const user = await apiWorker(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");

  const body = await readBody(req, MAX_BYTES + MAX_SELFIE_BYTES + 64 * 1024);
  if (!body) return fail(413, "The photo is too large.");
  const form = await body.formData().catch(() => null);
  if (!form) return fail(400, "The upload didn't arrive. Try again.");
  const kind = form.get("kind");
  if (kind !== "arrival" && kind !== "work" && kind !== "leave") return fail(400, "Unknown photo type.");
  const photo = await jpegField(form, "photo", MAX_BYTES);
  if (!photo) return fail(400, "No photo was attached.");
  if (photo === "too-large") return fail(413, "The photo is too large.");
  if (photo === "not-a-photo") return fail(400, "That file isn't a photo.");

  // The same photo sent again to this visit, e.g. after the answer to the first send was
  // lost on a bad connection: it's already saved.
  const sha256 = sha256Hex(photo);
  const resent = await queryOne<{ id: string; review: ReviewState }>(
    `SELECT p.id, p.review FROM job_photos p JOIN jobs j ON j.id = p.job_id
      WHERE p.job_id = $1 AND p.user_id = $2 AND p.kind = $3 AND p.sha256 = $4
        AND j.arrived_at IS NOT NULL AND p.created_at >= j.arrived_at`,
    [job.id, user.id, kind, sha256],
  );
  if (resent) return NextResponse.json({ ok: true, id: resent.id, review: resent.review, resent: true });

  if (job.status === "cancelled") return fail(409, "This job was cancelled.");
  if (job.status === "completed") return fail(409, "This job is already finished.");
  if (kind === "arrival" && job.status !== "assigned") return fail(409, "Your arrival is already recorded.");
  if (kind !== "arrival" && job.status !== "arrived") return fail(409, "Send your arrival photo first.");

  const mustBeOnSite = kind === "arrival" || kind === "leave";
  // "Can't check in here?": the photo goes to the manager instead of being refused.
  const reason = form.get("request");
  const request = mustBeOnSite && isRequestReason(reason) ? reason : null;
  const requestNote = String(form.get("requestNote") ?? "").trim().slice(0, 300);
  if (request === "other" && requestNote.length < 3) return fail(400, "Write why you can't check in here.");

  const lat = numberField(form.get("lat"));
  const lng = numberField(form.get("lng"));
  const accuracy = numberField(form.get("accuracy"));
  const located = lat !== null && lng !== null && accuracy !== null && accuracy >= 0 && isValidLatLng(lat, lng);
  let distance: number | null = null;
  let onSite = false;
  if (located) {
    const check = checkOnSite({ lat: job.site_lat, lng: job.site_lng, radius: job.radius_m }, { lat, lng, accuracy });
    distance = check.distance;
    onSite = check.ok;
    if (mustBeOnSite && !check.ok && !request) return fail(422, check.message, { distance: check.distance });
  } else if (mustBeOnSite && !request) {
    return fail(422, "Your location is needed. Allow location for this app and try again.");
  }
  // Inside the circle after all: there's nothing for the manager to approve.
  const asked = request && !onSite ? request : null;

  let selfie: Uint8Array | null = null;
  if (job.require_selfie && mustBeOnSite) {
    const s = await jpegField(form, "selfie", MAX_SELFIE_BYTES);
    if (!s) return fail(400, "Take the selfie too.");
    if (s === "too-large") return fail(413, "The selfie is too large.");
    if (s === "not-a-photo") return fail(400, "The selfie isn't a photo.");
    selfie = s;
  }

  // When the shutter was pressed, by the phone's clock.
  const takenAt = dateField(form.get("deviceTime"));
  if (mustBeOnSite) {
    const problem = photoTimeProblem(takenAt, new Date());
    if (problem) return fail(422, problem);
  }

  if (kind !== "arrival") {
    const [photos, skips] = await Promise.all([getJobPhotos(job.id), getJobSkips(job.id)]);
    const visit = photos.filter((p) => isCurrentVisit(job, p));
    if (kind === "work" && visit.filter((p) => p.kind === "work").length >= MAX_WORK_PHOTOS) {
      return fail(409, `This visit already has ${MAX_WORK_PHOTOS} work photos, the most it can have.`);
    }
    if (kind === "leave") {
      const missing = missingSteps(job, visit, skips.filter((s) => isCurrentVisit(job, s)));
      if (missing.length) return fail(409, `Before leaving, add: ${missing.join(", ")}.`);
    }
  }

  // The rest of the GPS reading, kept as evidence (all optional; phones leave some out).
  const fix = {
    altitude: rangeField(form.get("altitude"), -1000, 20_000),
    altitudeAccuracy: rangeField(form.get("altitudeAccuracy"), 0, 100_000),
    heading: rangeField(form.get("heading"), 0, 360),
    speed: rangeField(form.get("speed"), 0, 1000),
    time: recent(dateField(form.get("fixTime"))),
  };
  const settings = await getSettings();
  const [print, browser] = await Promise.all([imagePrint(photo), browserId()]);
  const country = req.headers.get("x-vercel-ip-country");
  const ipCountry = country && /^[A-Z]{2}$/.test(country) ? country : null;
  const selfieSha256 = selfie ? sha256Hex(selfie) : null;
  const flags = await findFlags({
    job,
    userId: user.id,
    kind,
    point: located ? { lat, lng, accuracy } : null,
    speed: fix.speed,
    fixTime: fix.time,
    takenAt,
    sha256,
    selfieSha256,
    print,
    browserId: browser,
    ipCountry,
    companyCountries: countriesForCallingCode(settings.countryCode),
    timezone: settings.timezone,
  });
  const strong = flags.filter(isStrongFlag);
  const review: ReviewState = asked || strong.length ? "pending" : "none";
  const why = asked ? REQUEST_REASONS[asked] : strong.map((f) => FLAGS[f.code].label).join(", ");

  const photoId = randomUUID();
  const key = `photos/${job.id}/${photoId}.jpg`;
  const selfieKey = selfie ? `photos/${job.id}/${photoId}-selfie.jpg` : null;
  try {
    await putFile(key, photo, "image/jpeg");
    if (selfie && selfieKey) await putFile(selfieKey, selfie, "image/jpeg");
  } catch (err) {
    if (err instanceof StorageError) return fail(507, err.message);
    throw err;
  }

  // The conditional statements make double taps and two phones harmless.
  const saved = await transaction(async (q) => {
    if (kind === "arrival") {
      const moved = await q.query(
        `UPDATE jobs SET status = 'arrived', arrived_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'assigned' AND assigned_to = $2 RETURNING id`,
        [job.id, user.id],
      );
      if (!moved.length) return false;
    } else if (kind === "leave") {
      const moved = await q.query(
        `UPDATE jobs SET status = 'completed', left_at = now(), completed_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'arrived' AND assigned_to = $2 RETURNING id`,
        [job.id, user.id],
      );
      if (!moved.length) return false;
    } else {
      // Lock the job, then count, so parallel uploads can't pass the limit together.
      const open = await q.query(
        "SELECT id FROM jobs WHERE id = $1 AND status = 'arrived' AND assigned_to = $2 FOR UPDATE",
        [job.id, user.id],
      );
      if (!open.length) return false;
      const [{ n }] = await q.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM job_photos p JOIN jobs j ON j.id = p.job_id
          WHERE p.job_id = $1 AND p.kind = 'work' AND p.created_at >= j.arrived_at`,
        [job.id],
      );
      if (n >= MAX_WORK_PHOTOS) return false;
    }
    await q.query(
      `INSERT INTO job_photos (id, job_id, user_id, kind, file_key, lat, lng, accuracy_m, distance_m,
                               on_site, live_camera, device_time, altitude_m, altitude_accuracy_m,
                               heading_deg, speed_mps, fix_time, sha256, phash, selfie_key,
                               selfie_sha256, browser_id, ip_country, flags, review, request_reason,
                               request_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               $19::bit(256), $20, $21, $22, $23, $24::jsonb, $25, $26, $27)`,
      [
        photoId,
        job.id,
        user.id,
        kind,
        key,
        located ? lat : null,
        located ? lng : null,
        located ? accuracy : null,
        distance,
        onSite,
        form.get("live") === "1",
        // Kept so the manager can see photos sent long after they were taken.
        takenAt && Math.abs(takenAt.getTime() - Date.now()) < 86_400_000 ? takenAt.toISOString() : null,
        located ? fix.altitude : null,
        located ? fix.altitudeAccuracy : null,
        located ? fix.heading : null,
        located ? fix.speed : null,
        located ? (fix.time?.toISOString() ?? null) : null,
        sha256,
        print?.hash ?? null,
        selfieKey,
        selfieSha256,
        browser,
        ipCountry,
        JSON.stringify(flags),
        review,
        asked,
        asked ? requestNote : "",
      ],
    );
    return true;
  });
  if (!saved) return fail(409, "This job changed in the meantime.");

  const pending = review === "pending" ? why : null;
  if (kind === "arrival") after(() => notifyArrival(job, user.name, distance, user.id, pending));
  else if (kind === "leave") after(() => notifyFinished(job, user.name, user.id, new Date(), pending));
  else if (pending) after(() => notifyReview(job, user.name, user.id, `Work photo: ${pending}`));
  return NextResponse.json({ ok: true, id: photoId, distance, onSite, review });
}

// A JPEG upload field: its bytes, null if missing, or why it was refused.
async function jpegField(form: FormData, name: string, maxBytes: number) {
  const file = form.get(name);
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > maxBytes) return "too-large" as const;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return imageInfo(bytes)?.type === "image/jpeg" ? bytes : ("not-a-photo" as const);
}

function dateField(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

// A time from the phone, if it's within a day of the server's.
function recent(d: Date | null): Date | null {
  return d && Math.abs(d.getTime() - Date.now()) < 86_400_000 ? d : null;
}

function rangeField(value: FormDataEntryValue | null, min: number, max: number): number | null {
  const n = numberField(value);
  return n !== null && n >= min && n <= max ? n : null;
}
