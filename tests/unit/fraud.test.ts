import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The warning signs on a real database (PGlite).
vi.mock("server-only", () => ({}));

process.env.PGLITE_DIR = path.join(os.tmpdir(), `site-checkin-fraud-${process.pid}-${Date.now()}`);
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { query } = await import("@/lib/db");
const { findFlags } = await import("@/lib/fraud");
type Evidence = Parameters<typeof findFlags>[0];

const SITE_A = { lat: 25.2048, lng: 55.2708 };
const SITE_A_NEXT_DOOR = { lat: 25.205, lng: 55.271 }; // ~30 m away
const SITE_B = { lat: 25.25, lng: 55.3 }; // ~6 km away
const users: Record<string, string> = {};
const jobs: Record<
  string,
  { id: string; title: string; site_lat: number; site_lng: number; arrived_at: Date | null; created_by: string | null; pin_from_photo: boolean }
> = {};

const bits = (seed: number) => Array.from({ length: 256 }, (_, i) => ((i * 7919 + seed * 104729) % 13 < 6 ? "1" : "0")).join("");
const flip = (hash: string, n: number) => hash.split("").map((b, i) => (i < n ? (b === "1" ? "0" : "1") : b)).join("");
const HASH = bits(1);

async function photo(job: string, user: string, values: Record<string, unknown>, ago = "1 hour") {
  const columns = Object.keys(values);
  await query(
    `INSERT INTO job_photos (job_id, user_id, kind, file_key, created_at, ${columns.join(", ")})
     VALUES ($1, $2, 'arrival', 'photos/x.jpg', now() - $3::interval, ${columns.map((c, i) => (c === "phash" ? `$${i + 4}::bit(256)` : `$${i + 4}`)).join(", ")})`,
    [jobs[job].id, users[user], ago, ...Object.values(values)],
  );
}

function evidence(job: string, user: string, more: Partial<Evidence> = {}): Evidence {
  return {
    job: jobs[job],
    userId: users[user],
    kind: "arrival",
    point: { ...(job === "B" ? SITE_B : SITE_A), lat: (job === "B" ? SITE_B : SITE_A).lat + 0.0002, accuracy: 12 },
    speed: null,
    fixTime: null,
    takenAt: null,
    sha256: `sha-${Math.random()}`,
    selfieSha256: null,
    print: null,
    browserId: null,
    ipCountry: null,
    companyCountries: ["AE"],
    timezone: "Asia/Dubai",
    ...more,
  };
}

const codes = async (e: Evidence) => (await findFlags(e)).map((f) => f.code);

beforeAll(async () => {
  for (const name of ["Maya", "Ravi", "Sara", "Tom"]) {
    const [row] = await query<{ id: string }>(
      "INSERT INTO users (name, phone, role, pin_hash) VALUES ($1, $2, $3, 'x') RETURNING id",
      [name, `9715000000${Object.keys(users).length}`, name === "Maya" ? "manager" : "worker"],
    );
    users[name] = row.id;
  }
  for (const [name, site] of [["A", SITE_A], ["A2", SITE_A_NEXT_DOOR], ["B", SITE_B]] as const) {
    const [row] = await query<(typeof jobs)[string]>(
      `INSERT INTO jobs (title, site_lat, site_lng, created_by) VALUES ($1, $2, $3, $4)
       RETURNING id, title, site_lat, site_lng, arrived_at, created_by, pin_from_photo`,
      [`Job ${name}`, site.lat, site.lng, users.Maya],
    );
    jobs[name] = row;
  }
}, 30_000);

describe("findFlags", () => {
  it("finds nothing wrong with an ordinary check-in", async () => {
    expect(await findFlags(evidence("A", "Ravi"))).toEqual([]);
  });

  it("spots the same file sent again, as a photo or as a selfie", async () => {
    await photo("B", "Sara", { sha256: "dup-photo", selfie_sha256: "dup-selfie" });
    const flags = await findFlags(evidence("A", "Ravi", { sha256: "dup-photo" }));
    expect(flags).toMatchObject([{ code: "duplicate_photo", jobId: jobs.B.id }]);
    expect(flags[0].detail).toContain("Job B");
    expect(await codes(evidence("A", "Ravi", { selfieSha256: "dup-selfie" }))).toEqual(["duplicate_photo"]);
    expect(await codes(evidence("A", "Ravi", { sha256: "same", selfieSha256: "same" }))).toEqual(["duplicate_photo"]);
  });

  it("spots a look-alike of someone else's photo, but not a new photo", async () => {
    await photo("B", "Sara", { phash: HASH }, "3 hours");
    expect(await codes(evidence("A", "Ravi", { print: { hash: flip(HASH, 5), blank: false } }))).toEqual(["similar_photo"]);
    expect(await codes(evidence("A", "Ravi", { print: { hash: flip(HASH, 40), blank: false } }))).toEqual([]);
  });

  it("lets a worker's photos from two jobs in one building look alike, but not across town", async () => {
    const own = bits(2);
    await photo("A2", "Tom", { phash: own }, "30 minutes");
    expect(await codes(evidence("A", "Tom", { print: { hash: own, blank: false }, point: null }))).toEqual([]);
    expect(await codes(evidence("B", "Tom", { print: { hash: own, blank: false }, point: null }))).toEqual(["similar_photo"]);
  });

  it("compares a visit's photos with each other only for exact copies", async () => {
    await query("UPDATE jobs SET status = 'arrived', arrived_at = now() - interval '10 minutes' WHERE id = $1", [jobs.A2.id]);
    const visit = bits(3);
    await photo("A2", "Sara", { phash: visit }, "5 minutes");
    const job = { ...jobs.A2, arrived_at: new Date(Date.now() - 10 * 60_000) };
    expect(await codes({ ...evidence("A2", "Sara", { print: { hash: visit, blank: false }, point: null }), job, kind: "work" })).toEqual([]);
  });

  it("spots a blank photo", async () => {
    expect(await codes(evidence("A", "Ravi", { print: { hash: "0".repeat(256), blank: true } }))).toEqual(["blank_photo"]);
  });

  it("spots travel faster than a car between two check-ins", async () => {
    // About 6 km in a minute.
    await photo("B", "Tom", { lat: SITE_B.lat, lng: SITE_B.lng, accuracy_m: 10 }, "1 minute");
    const flags = await findFlags(evidence("A", "Tom"));
    expect(flags.map((f) => f.code)).toEqual(["impossible_travel"]);
    expect(flags[0].detail).toMatch(/km from the photo at “Job B” 1 min earlier/);
  });

  it("allows the same trip with time to drive it", async () => {
    await query("UPDATE job_photos SET created_at = now() - interval '2 hours' WHERE user_id = $1", [users.Tom]);
    expect(await codes(evidence("A", "Tom"))).toEqual([]);
  });

  it("ignores readings sent for approval or rejected as where someone was", async () => {
    await query("UPDATE job_photos SET created_at = now() - interval '1 minute' WHERE user_id = $1 AND lat IS NOT NULL", [users.Tom]);
    expect(await codes(evidence("A", "Tom"))).toEqual(["impossible_travel"]);
    await query("UPDATE job_photos SET request_reason = 'gps_wrong' WHERE user_id = $1", [users.Tom]);
    expect(await codes(evidence("A", "Tom"))).toEqual([]);
    await query("UPDATE job_photos SET request_reason = NULL, review = 'rejected' WHERE user_id = $1", [users.Tom]);
    expect(await codes(evidence("A", "Tom"))).toEqual([]);
    await query("UPDATE job_photos SET review = 'none' WHERE user_id = $1", [users.Tom]);
  });

  it("counts the time an earlier photo waited on the phone for signal", async () => {
    // Taken at B 12 minutes ago, sent only a minute ago (no signal): a 6 km trip since is fine.
    await query(
      `UPDATE job_photos SET created_at = now() - interval '1 minute', device_time = now() - interval '12 minutes'
        WHERE user_id = $1 AND lat IS NOT NULL`,
      [users.Tom],
    );
    expect(await codes(evidence("A", "Tom"))).toEqual([]);
  });

  it("spots one phone sending check-ins for two people", async () => {
    await photo("B", "Sara", { browser_id: "phone-1" }, "1 hour");
    const flags = await findFlags(evidence("A", "Ravi", { browserId: "phone-1" }));
    expect(flags.map((f) => f.code)).toEqual(["shared_phone"]);
    expect(flags[0].detail).toContain("Sara's photo");
    expect(await codes(evidence("A", "Sara", { browserId: "phone-1" }))).toEqual([]);
  });

  it("notes a GPS point repeated to the last digit", async () => {
    const point = { lat: 25.123456789, lng: 55.987654321, accuracy: 8 };
    await photo("B", "Sara", { lat: point.lat, lng: point.lng, accuracy_m: 8 }, "1 day");
    expect(await codes(evidence("A", "Ravi", { point }))).toEqual(["same_point"]);
    expect(await codes(evidence("A", "Ravi", { point: { ...point, lng: point.lng + 0.000001 } }))).toEqual([]);
  });

  it("spots a GPS reading copied from the job pin, unless the manager checks in at their own pin", async () => {
    const atPin = { ...SITE_A, accuracy: 5 };
    expect(await codes(evidence("A", "Ravi", { point: atPin }))).toEqual(["at_pin"]);
    expect(await codes(evidence("A", "Maya", { point: atPin }))).toEqual([]);
    // A pin moved to a check-in photo's reading: the same reading again is honest.
    expect(await codes({ ...evidence("A", "Ravi", { point: atPin }), job: { ...jobs.A, pin_from_photo: true } })).toEqual([]);
  });

  it("notes speed, too-perfect GPS, an old GPS reading and a foreign connection", async () => {
    const now = new Date();
    const flags = await codes(
      evidence("A", "Ravi", {
        speed: 30,
        point: { lat: SITE_A.lat + 0.0003, lng: SITE_A.lng, accuracy: 0.5 },
        takenAt: now,
        fixTime: new Date(now.getTime() - 5 * 60_000),
        ipCountry: "IN",
      }),
    );
    expect(flags).toEqual(["moving_fast", "perfect_accuracy", "stale_fix", "ip_country"]);
    expect(await codes(evidence("A", "Ravi", { ipCountry: "AE", speed: 2 }))).toEqual([]);
  });
});
