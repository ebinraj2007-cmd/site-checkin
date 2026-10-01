import "server-only";
import { query, queryOne } from "./db";
import { distanceMeters, formatDistance, type LatLng } from "./geo";
import type { Flag, Job, PhotoKind } from "./job-rules";
import { countryName } from "./phone";
import type { ImagePrint } from "./photo-hash";
import { formatDuration, formatWhen } from "./time";

// Warning signs in an uploaded photo. None of them is proof on its own: strong ones send
// the photo to the manager's review (it counts once approved), the others are shown on
// the photo. Each threshold is set so that an honest check-in practically never trips it.

// Look-alike photos: of 256 bits, re-saved, re-stamped or brightened copies of a photo
// differ in 0–10; a new photo of the same scene, moved by even 1%, in 20 or more.
export const SIMILAR_MAX_BITS = 12;
// Two jobs at the same place within a couple of hours (e.g. two jobs in one building)
// can produce look-alike photos from the same worker honestly.
const SAME_PLACE_M = 500;
const SAME_PLACE_WINDOW_MS = 2 * 3600_000;
// Faster than 180 km/h between two check-ins more than a kilometre apart.
const TRAVEL_MIN_M = 1000;
const TRAVEL_MAX_MPS = 50;
const SEND_DELAY_MS = 15 * 60_000;
// A reading this close to the pin is a copy of its coordinates, not a GPS fix.
const AT_PIN_M = 0.05;
const FAST_MPS = 25; // 90 km/h
const PERFECT_ACCURACY_M = 1;
const STALE_FIX_MS = 120_000;
const FUTURE_FIX_MS = 60_000;

export type Evidence = {
  job: Pick<Job, "id" | "title" | "site_lat" | "site_lng" | "arrived_at" | "created_by" | "pin_from_photo">;
  userId: string;
  kind: PhotoKind;
  point: (LatLng & { accuracy: number }) | null;
  speed: number | null; // m/s, as reported by the phone
  fixTime: Date | null; // when the GPS reading was made, by the phone's clock
  takenAt: Date | null; // when the shutter was pressed, by the phone's clock
  sha256: string;
  selfieSha256: string | null;
  print: ImagePrint | null;
  browserId: string | null; // hash of this browser's random ID
  ipCountry: string | null; // where the internet connection comes from, e.g. "AE"
  companyCountries: string[]; // countries of the company's calling code
  timezone: string;
  now?: Date;
};

type Other = { job_id: string; title: string; created_at: Date };

// Photos of the visit this one belongs to are compared with each other only for exact
// copies; a new arrival photo starts a new visit.
function visitStart(e: Evidence): string | null {
  return e.kind === "arrival" || !e.job.arrived_at ? null : e.job.arrived_at.toISOString();
}
const OUTSIDE_VISIT = "NOT (p.job_id = $2 AND $3::timestamptz IS NOT NULL AND p.created_at >= $3::timestamptz)";

export async function findFlags(e: Evidence): Promise<Flag[]> {
  const found = await Promise.all([
    duplicatePhoto(e),
    similarPhoto(e),
    impossibleTravel(e),
    sharedPhone(e),
    samePoint(e),
  ]);
  const flags = found.flat().filter((f): f is Flag => f !== null);
  const site = { lat: e.job.site_lat, lng: e.job.site_lng };
  if (e.print?.blank) flags.push({ code: "blank_photo", detail: "The picture shows almost nothing." });
  // Not when the pin is the manager's own reading, or was moved to a check-in photo's
  // reading (indoor positioning can repeat the same coordinates honestly).
  if (e.point && e.job.created_by !== e.userId && !e.job.pin_from_photo && distanceMeters(site, e.point) < AT_PIN_M) {
    flags.push({
      code: "at_pin",
      detail: "The GPS reading is exactly on the job pin. Fake-location apps are often set to the pin's coordinates.",
    });
  }
  if (e.speed !== null && e.speed > FAST_MPS) {
    flags.push({ code: "moving_fast", detail: `Moving at ${Math.round(e.speed * 3.6)} km/h when the photo was taken.` });
  }
  if (e.point && e.point.accuracy < PERFECT_ACCURACY_M) {
    flags.push({
      code: "perfect_accuracy",
      detail: `The phone reported GPS accurate to ±${e.point.accuracy.toFixed(1)} m; phones are rarely better than ±3 m.`,
    });
  }
  if (e.point && e.fixTime && e.takenAt) {
    const age = e.takenAt.getTime() - e.fixTime.getTime();
    if (age > STALE_FIX_MS) {
      flags.push({ code: "stale_fix", detail: `The GPS reading was ${formatDuration(age)} older than the photo.` });
    } else if (age < -FUTURE_FIX_MS) {
      flags.push({ code: "stale_fix", detail: "The GPS reading is dated after the photo." });
    }
  }
  if (e.ipCountry && e.companyCountries.length && !e.companyCountries.includes(e.ipCountry)) {
    flags.push({ code: "ip_country", detail: `Sent over an internet connection from ${countryName(e.ipCountry)}.` });
  }
  return flags;
}

// Byte-for-byte the same file as an earlier photo or selfie (a resend of the same upload
// to the same visit is caught before this, by the upload route).
async function duplicatePhoto(e: Evidence): Promise<Flag[]> {
  const flags: Flag[] = [];
  const earlier = (sha: string) =>
    queryOne<Other>(
      `SELECT p.job_id, j.title, p.created_at FROM job_photos p JOIN jobs j ON j.id = p.job_id
        WHERE p.sha256 = $1 OR p.selfie_sha256 = $1 ORDER BY p.created_at LIMIT 1`,
      [sha],
    );
  const photo = await earlier(e.sha256);
  if (photo) {
    flags.push({
      code: "duplicate_photo",
      detail: `The same file as a photo from “${photo.title}”, ${formatWhen(photo.created_at, e.timezone)}.`,
      jobId: photo.job_id,
    });
  }
  if (e.selfieSha256) {
    const selfie = e.selfieSha256 === e.sha256 ? null : await earlier(e.selfieSha256);
    if (selfie || e.selfieSha256 === e.sha256) {
      flags.push({
        code: "duplicate_photo",
        detail: selfie
          ? `The selfie is the same file as one from “${selfie.title}”, ${formatWhen(selfie.created_at, e.timezone)}.`
          : "The selfie is the same file as the photo.",
        jobId: selfie?.job_id,
      });
    }
  }
  return flags;
}

async function similarPhoto(e: Evidence): Promise<Flag | null> {
  if (!e.print || e.print.blank) return null;
  const rows = await query<Other & { user_id: string | null; site_lat: number; site_lng: number }>(
    `SELECT p.job_id, j.title, p.created_at, p.user_id, j.site_lat, j.site_lng
       FROM job_photos p JOIN jobs j ON j.id = p.job_id
      WHERE p.phash IS NOT NULL AND bit_count(p.phash # $1::bit(256)) <= $4 AND ${OUTSIDE_VISIT}
      ORDER BY bit_count(p.phash # $1::bit(256)), p.created_at DESC
      LIMIT 10`,
    [e.print.hash, e.job.id, visitStart(e), SIMILAR_MAX_BITS],
  );
  const now = (e.now ?? new Date()).getTime();
  const site = { lat: e.job.site_lat, lng: e.job.site_lng };
  const hit = rows.find(
    (r) =>
      !(
        r.user_id === e.userId &&
        now - r.created_at.getTime() < SAME_PLACE_WINDOW_MS &&
        distanceMeters(site, { lat: r.site_lat, lng: r.site_lng }) < SAME_PLACE_M
      ),
  );
  if (!hit) return null;
  return {
    code: "similar_photo",
    detail: `Looks like a photo from “${hit.title}”, ${formatWhen(hit.created_at, e.timezone)}.`,
    jobId: hit.job_id,
  };
}

// Compared with the same person's previous check-in, from any job. Only a reading the app
// trusted counts as where they were: not one sent for approval ("my GPS is wrong") or
// rejected by the manager.
async function impossibleTravel(e: Evidence): Promise<Flag | null> {
  if (!e.point || e.point.accuracy > 100) return null;
  const prev = await queryOne<Other & { lat: number; lng: number; accuracy_m: number; device_time: Date | null }>(
    `SELECT p.job_id, j.title, p.created_at, p.lat, p.lng, p.accuracy_m, p.device_time
       FROM job_photos p JOIN jobs j ON j.id = p.job_id
      WHERE p.user_id = $1 AND p.lat IS NOT NULL AND p.accuracy_m <= 100
        AND p.request_reason IS NULL AND p.review <> 'rejected'
        AND p.created_at > now() - interval '12 hours'
      ORDER BY p.created_at DESC LIMIT 1`,
    [e.userId],
  );
  if (!prev) return null;
  // Give both readings the benefit of their stated accuracy, and the earlier photo the
  // time it waited on the phone for signal (up to the 15 minutes a check-in may wait).
  const gap = distanceMeters(prev, e.point) - prev.accuracy_m - e.point.accuracy;
  const waited = prev.device_time ? prev.created_at.getTime() - prev.device_time.getTime() : 0;
  const elapsed = (e.now ?? new Date()).getTime() - prev.created_at.getTime() + Math.min(Math.max(waited, 0), SEND_DELAY_MS);
  const seconds = Math.max(1, elapsed / 1000);
  if (gap <= TRAVEL_MIN_M || gap / seconds <= TRAVEL_MAX_MPS) return null;
  return {
    code: "impossible_travel",
    detail: `${formatDistance(distanceMeters(prev, e.point))} from the photo at “${prev.title}” ${formatDuration(seconds * 1000)} earlier (over ${Math.round((gap / seconds) * 3.6)} km/h).`,
    jobId: prev.job_id,
  };
}

// Buddy check-ins: this browser sent someone else's photo recently.
async function sharedPhone(e: Evidence): Promise<Flag | null> {
  if (!e.browserId) return null;
  const other = await queryOne<{ name: string; created_at: Date }>(
    `SELECT u.name, p.created_at FROM job_photos p JOIN users u ON u.id = p.user_id
      WHERE p.browser_id = $1 AND p.user_id <> $2 AND p.created_at > now() - interval '12 hours'
      ORDER BY p.created_at DESC LIMIT 1`,
    [e.browserId, e.userId],
  );
  if (!other) return null;
  return {
    code: "shared_phone",
    detail: `Sent from the phone that sent ${other.name}'s photo at ${formatWhen(other.created_at, e.timezone)}.`,
  };
}

// Two real GPS fixes are never identical to the last digit; a fake-location app repeats one.
async function samePoint(e: Evidence): Promise<Flag | null> {
  if (!e.point || e.point.accuracy > 100) return null;
  const other = await queryOne<Other>(
    `SELECT p.job_id, j.title, p.created_at FROM job_photos p JOIN jobs j ON j.id = p.job_id
      WHERE p.lat = $1 AND p.lng = $4 AND ${OUTSIDE_VISIT}
      ORDER BY p.created_at DESC LIMIT 1`,
    [e.point.lat, e.job.id, visitStart(e), e.point.lng],
  );
  if (!other) return null;
  return {
    code: "same_point",
    detail: `Exactly the same GPS point as a photo from “${other.title}”, ${formatWhen(other.created_at, e.timezone)}.`,
    jobId: other.job_id,
  };
}
