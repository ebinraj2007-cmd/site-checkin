import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Overlap detection on a real database (PGlite).
vi.mock("server-only", () => ({}));

process.env.PGLITE_DIR = path.join(os.tmpdir(), `site-checkin-visits-${process.pid}-${Date.now()}`);
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { query } = await import("@/lib/db");
const { overlappingVisits } = await import("@/lib/jobs");

const SITE_A = { lat: 25.2048, lng: 55.2708 };
const SITE_A_NEXT_DOOR = { lat: 25.2050, lng: 55.2710 }; // ~30 m away
const SITE_B = { lat: 25.25, lng: 55.3 }; // ~6 km away
const ids: Record<string, string> = {};

async function job(
  name: string,
  worker: string,
  site: { lat: number; lng: number },
  visit: { status: string; arrived?: string; left?: string; completed?: string },
) {
  const [row] = await query<{ id: string }>(
    `INSERT INTO jobs (title, site_lat, site_lng, assigned_to, status, arrived_at, left_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [name, site.lat, site.lng, worker, visit.status, visit.arrived ?? null, visit.left ?? null, visit.completed ?? null],
  );
  ids[name] = row.id;
}

beforeAll(async () => {
  const [ravi] = await query<{ id: string }>(
    "INSERT INTO users (name, phone, role, pin_hash) VALUES ('Ravi', '971502222222', 'worker', 'x') RETURNING id",
  );
  const [sam] = await query<{ id: string }>(
    "INSERT INTO users (name, phone, role, pin_hash) VALUES ('Sam', '971503333333', 'worker', 'x') RETURNING id",
  );
  const day = "2026-09-27T";
  // Ravi claims 09:00–12:00 at A while checking in at B from 10:00 to 11:00.
  await job("A", ravi.id, SITE_A, { status: "completed", arrived: `${day}09:00Z`, left: `${day}12:00Z`, completed: `${day}12:00Z` });
  await job("B", ravi.id, SITE_B, { status: "completed", arrived: `${day}10:00Z`, left: `${day}11:00Z`, completed: `${day}11:00Z` });
  // Next door to A at the same time: plausible (same building), not flagged.
  await job("A2", ravi.id, SITE_A_NEXT_DOOR, { status: "completed", arrived: `${day}09:15Z`, left: `${day}09:45Z`, completed: `${day}09:45Z` });
  // Later the same day at B: no overlap.
  await job("B-later", ravi.id, SITE_B, { status: "completed", arrived: `${day}13:00Z`, left: `${day}14:00Z`, completed: `${day}14:00Z` });
  // Someone else at B during A: not Ravi's problem.
  await job("Sam-B", sam.id, SITE_B, { status: "completed", arrived: `${day}09:30Z`, left: `${day}10:30Z`, completed: `${day}10:30Z` });
  // Finished without a leaving photo: only its arrival moment (13:30) counts, inside B-later.
  await job("Finished-no-photo", ravi.id, SITE_A, { status: "completed", arrived: `${day}13:30Z`, completed: `${day}18:00Z` });
}, 30_000);

describe("overlappingVisits", () => {
  it("flags the same worker checked in at two far-apart sites at once, both ways", async () => {
    const a = await overlappingVisits(ids.A);
    expect(a.map((o) => o.other_title)).toEqual(["B"]);
    expect(a[0].distance_m).toBeGreaterThan(5000);
    expect((await overlappingVisits(ids.B)).map((o) => o.other_title)).toEqual(["A"]);
  });

  it("leaves nearby sites, other workers and separate times alone", async () => {
    expect(await overlappingVisits(ids.A2)).toEqual([]);
    expect(await overlappingVisits(ids["Sam-B"])).toEqual([]);
  });

  it("uses only the arrival moment of a job finished without a leaving photo", async () => {
    expect((await overlappingVisits(ids["Finished-no-photo"])).map((o) => o.other_title)).toEqual(["B-later"]);
  });

  it("lists every flagged job when asked for all", async () => {
    const all = new Set((await overlappingVisits()).map((o) => o.job_id));
    expect(all).toEqual(new Set([ids.A, ids.B, ids["B-later"], ids["Finished-no-photo"]]));
  });
});
