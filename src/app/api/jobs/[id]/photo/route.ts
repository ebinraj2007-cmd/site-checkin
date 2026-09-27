import { randomUUID } from "node:crypto";
import { NextResponse, after } from "next/server";
import { apiUser, fail, numberField, tooLarge } from "@/lib/api";
import { notifyArrival, notifyFinished } from "@/lib/checkin-notify";
import { transaction } from "@/lib/db";
import { checkOnSite, isValidLatLng } from "@/lib/geo";
import { getJob, getJobPhotos, missingSteps, type PhotoKind } from "@/lib/jobs";
import { putFile, sniffImage } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024;

// Arrival, work and leaving photos. The server re-checks the GPS reading against the
// job site; only arrival and leaving photos must be inside the check-in circle.
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/photo">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  if (tooLarge(req, MAX_BYTES + 64 * 1024)) return fail(413, "The photo is too large.");
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");

  const form = await req.formData().catch(() => null);
  if (!form) return fail(400, "The upload didn't arrive. Try again.");
  const kind = form.get("kind") as PhotoKind;
  if (!["arrival", "work", "leave"].includes(kind)) return fail(400, "Unknown photo type.");
  const photo = form.get("photo");
  if (!(photo instanceof File) || photo.size === 0) return fail(400, "No photo was attached.");
  if (photo.size > MAX_BYTES) return fail(413, "The photo is too large.");
  const bytes = new Uint8Array(await photo.arrayBuffer());
  const type = sniffImage(bytes);
  if (!type) return fail(400, "That file isn't a photo.");

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

  if (kind === "leave") {
    const missing = missingSteps(job, await getJobPhotos(job.id));
    if (missing.length) return fail(409, `Before leaving, add: ${missing.join(", ")}.`);
  }

  const deviceTime = parseDeviceTime(form.get("deviceTime"));
  const photoId = randomUUID();
  const key = `photos/${job.id}/${photoId}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  await putFile(key, bytes, type);

  // The conditional UPDATE makes double taps and two phones harmless.
  const saved = await transaction(async (q) => {
    const moved =
      kind === "arrival"
        ? await q.query(
            `UPDATE jobs SET status = 'arrived', arrived_at = now(), updated_at = now()
              WHERE id = $1 AND status = 'assigned' AND assigned_to = $2 RETURNING id`,
            [job.id, user.id],
          )
        : kind === "leave"
          ? await q.query(
              `UPDATE jobs SET status = 'completed', left_at = now(), completed_at = now(), updated_at = now()
                WHERE id = $1 AND status = 'arrived' AND assigned_to = $2 RETURNING id`,
              [job.id, user.id],
            )
          : await q.query("SELECT id FROM jobs WHERE id = $1 AND status = 'arrived' AND assigned_to = $2", [
              job.id,
              user.id,
            ]);
    if (!moved.length) return false;
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
        deviceTime?.toISOString() ?? null,
      ],
    );
    return true;
  });
  if (!saved) return fail(409, "This job changed in the meantime. Reload the page.");

  if (kind === "arrival") after(() => notifyArrival(job, user.name, distance, user.id));
  if (kind === "leave") after(() => notifyFinished(job, user.name, new Date(), user.id));
  return NextResponse.json({ ok: true, id: photoId, distance, onSite });
}

// The phone's clock, kept for the record. Ignored if it is more than a day off.
function parseDeviceTime(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) && Math.abs(d.getTime() - Date.now()) < 86_400_000 ? d : null;
}
