import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { apiUser, fail, numberField, readBody } from "@/lib/api";
import { notifyArrival, notifyFinished } from "@/lib/checkin-notify";
import { transaction } from "@/lib/db";
import { checkOnSite, isValidLatLng } from "@/lib/geo";
import { imageInfo } from "@/lib/image-check";
import { getJob, getJobPhotos, isCurrentVisit, MAX_WORK_PHOTOS, missingSteps, photoTimeProblem } from "@/lib/jobs";
import { putFile, StorageError } from "@/lib/storage";

// The app sends JPEGs of at most 1600 px, a few hundred KB each.
const MAX_BYTES = 2 * 1024 * 1024;

// Arrival, work and leaving photos. The server re-checks the GPS reading against the
// job site; only arrival and leaving photos must be inside the check-in circle, and
// only fresh ones count (the server's clock is what goes on record).
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/photo">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");

  const body = await readBody(req, MAX_BYTES + 64 * 1024);
  if (!body) return fail(413, "The photo is too large.");
  const form = await body.formData().catch(() => null);
  if (!form) return fail(400, "The upload didn't arrive. Try again.");
  const kind = form.get("kind");
  if (kind !== "arrival" && kind !== "work" && kind !== "leave") return fail(400, "Unknown photo type.");
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return fail(400, "No photo was attached.");
  if (photo.size > MAX_BYTES) return fail(413, "The photo is too large.");
  const bytes = new Uint8Array(await photo.arrayBuffer());
  if (imageInfo(bytes)?.type !== "image/jpeg") return fail(400, "That file isn't a photo.");

  if (job.status === "cancelled") return fail(409, "This job was cancelled.");
  if (job.status === "completed") return fail(409, "This job is already finished.");
  if (kind === "arrival" && job.status !== "assigned") return fail(409, "Your arrival is already recorded.");
  if (kind !== "arrival" && job.status !== "arrived") return fail(409, "Send your arrival photo first.");

  const lat = numberField(form.get("lat"));
  const lng = numberField(form.get("lng"));
  const accuracy = numberField(form.get("accuracy"));
  const located = lat !== null && lng !== null && accuracy !== null && accuracy >= 0 && isValidLatLng(lat, lng);
  const mustBeOnSite = kind === "arrival" || kind === "leave";
  let distance: number | null = null;
  let onSite = false;
  if (located) {
    const check = checkOnSite({ lat: job.site_lat, lng: job.site_lng, radius: job.radius_m }, { lat, lng, accuracy });
    distance = check.distance;
    onSite = check.ok;
    if (mustBeOnSite && !check.ok) return fail(422, check.message, { distance: check.distance });
  } else if (mustBeOnSite) {
    return fail(422, "Your location is needed. Allow location for this app and try again.");
  }

  // When the shutter was pressed, by the phone's clock.
  const takenAt = dateField(form.get("deviceTime"));
  if (mustBeOnSite) {
    const problem = photoTimeProblem(takenAt, new Date());
    if (problem) return fail(422, problem);
  }

  if (kind !== "arrival") {
    const visit = (await getJobPhotos(job.id)).filter((p) => isCurrentVisit(job, p));
    if (kind === "work" && visit.filter((p) => p.kind === "work").length >= MAX_WORK_PHOTOS) {
      return fail(409, `This visit already has ${MAX_WORK_PHOTOS} work photos, the most it can have.`);
    }
    if (kind === "leave") {
      const missing = missingSteps(job, visit);
      if (missing.length) return fail(409, `Before leaving, add: ${missing.join(", ")}.`);
    }
  }

  const photoId = randomUUID();
  const key = `photos/${job.id}/${photoId}.jpg`;
  try {
    await putFile(key, bytes, "image/jpeg");
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
                               on_site, live_camera, device_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
      ],
    );
    return true;
  });
  if (!saved) return fail(409, "This job changed in the meantime.");

  if (kind === "arrival") after(() => notifyArrival(job, user.name, distance, user.id));
  if (kind === "leave") after(() => notifyFinished(job, user.name, user.id, new Date()));
  return NextResponse.json({ ok: true, id: photoId, distance, onSite });
}

function dateField(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}
