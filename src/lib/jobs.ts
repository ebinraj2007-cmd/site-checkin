import "server-only";
import { query, queryOne } from "./db";
import { isUuid, type Job, type JobPhoto } from "./job-rules";

export * from "./job-rules";

const JOB_SELECT = `
  SELECT j.*, u.name AS worker_name, u.phone AS worker_phone
    FROM jobs j LEFT JOIN users u ON u.id = j.assigned_to`;

export async function getJob(id: string): Promise<Job | null> {
  if (!isUuid(id)) return null;
  return queryOne<Job>(`${JOB_SELECT} WHERE j.id = $1`, [id]);
}

export async function getJobPhotos(jobId: string): Promise<JobPhoto[]> {
  return query<JobPhoto>("SELECT * FROM job_photos WHERE job_id = $1 ORDER BY created_at", [jobId]);
}

export type JobFilter = {
  view?: "open" | "done" | "cancelled" | "all";
  workerId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export async function listJobs(filter: JobFilter = {}): Promise<Job[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  const view = filter.view ?? "open";
  if (view === "open") where.push("j.status IN ('assigned', 'arrived')");
  if (view === "done") where.push("j.status = 'completed'");
  if (view === "cancelled") where.push("j.status = 'cancelled'");
  if (filter.workerId && isUuid(filter.workerId)) add("j.assigned_to = ?", filter.workerId);
  if (filter.from) add("COALESCE(j.scheduled_at, j.created_at) >= ?", filter.from.toISOString());
  if (filter.to) add("COALESCE(j.scheduled_at, j.created_at) < ?", filter.to.toISOString());
  const order =
    view === "open"
      ? "j.scheduled_at ASC NULLS LAST, j.created_at ASC"
      : view === "done"
        ? "j.completed_at DESC"
        : "COALESCE(j.scheduled_at, j.created_at) DESC";
  params.push(filter.limit ?? 200);
  return query<Job>(
    `${JOB_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY ${order} LIMIT $${params.length}`,
    params,
  );
}

// A worker sees open jobs plus the ones they finished in the last week.
export async function jobsForWorker(userId: string): Promise<Job[]> {
  return query<Job>(
    `${JOB_SELECT}
      WHERE j.assigned_to = $1
        AND (j.status IN ('assigned', 'arrived')
             OR (j.status = 'completed' AND j.completed_at > now() - interval '7 days'))
      ORDER BY (j.status = 'completed'), j.scheduled_at ASC NULLS LAST, j.created_at ASC`,
    [userId],
  );
}

export type Checkin = {
  id: string;
  kind: "arrival" | "leave";
  created_at: Date;
  distance_m: number | null;
  file_key: string;
  job_id: string;
  title: string;
  worker_name: string | null;
};

export async function recentCheckins(limit = 8): Promise<Checkin[]> {
  return query<Checkin>(
    `SELECT p.id, p.kind, p.created_at, p.distance_m, p.file_key, j.id AS job_id, j.title, u.name AS worker_name
       FROM job_photos p
       JOIN jobs j ON j.id = p.job_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind IN ('arrival', 'leave')
      ORDER BY p.created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export async function countCompletedBetween(from: Date, to: Date): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM jobs WHERE completed_at >= $1 AND completed_at < $2",
    [from.toISOString(), to.toISOString()],
  );
  return row?.n ?? 0;
}

// Where the map starts when creating a job: the most recent job's site.
export async function lastJobSite(): Promise<{ lat: number; lng: number } | null> {
  const row = await queryOne<{ site_lat: number; site_lng: number }>(
    "SELECT site_lat, site_lng FROM jobs ORDER BY created_at DESC LIMIT 1",
  );
  return row ? { lat: row.site_lat, lng: row.site_lng } : null;
}
