import "server-only";
import { query, queryOne } from "./db";
import type { JobPhoto, JobSkip, JobStatus } from "./job-rules";

// What waits for a manager's review: photos sent for approval or with strong warning
// signs, and customer steps skipped with a reason.

export type PhotoForReview = JobPhoto & {
  job_title: string;
  job_status: JobStatus;
  job_arrived_at: Date | null;
  site_lat: number;
  site_lng: number;
  radius_m: number;
};

const PHOTO_SELECT = `
  SELECT p.*, u.name AS user_name, r.name AS reviewer_name, j.title AS job_title, j.status AS job_status,
         j.arrived_at AS job_arrived_at, j.site_lat, j.site_lng, j.radius_m
    FROM job_photos p
    JOIN jobs j ON j.id = p.job_id
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN users r ON r.id = p.reviewed_by`;

export async function photosToReview(): Promise<PhotoForReview[]> {
  return query<PhotoForReview>(`${PHOTO_SELECT} WHERE p.review = 'pending' ORDER BY p.created_at`);
}

export type SkipForReview = JobSkip & {
  job_title: string;
  customer_name: string;
  customer_phone: string;
};

export async function skipsToReview(): Promise<SkipForReview[]> {
  return query<SkipForReview>(
    `SELECT s.*, u.name AS user_name, j.title AS job_title, j.customer_name, j.customer_phone
       FROM job_skips s JOIN jobs j ON j.id = s.job_id LEFT JOIN users u ON u.id = s.user_id
      WHERE s.review = 'pending' ORDER BY s.created_at`,
  );
}

export async function reviewCount(): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT ((SELECT count(*) FROM job_photos WHERE review = 'pending')
           + (SELECT count(*) FROM job_skips WHERE review = 'pending'))::int AS n`,
  );
  return row?.n ?? 0;
}

export type Decision = {
  kind: "photo" | "skip";
  id: string;
  job_id: string;
  job_title: string;
  worker_name: string | null;
  what: string; // photo kind, or the skipped step
  review: "approved" | "rejected";
  reviewer_name: string | null;
  reviewed_at: Date;
  review_note: string;
};

// The latest decisions, so other managers can see who approved what.
export async function recentDecisions(limit = 15): Promise<Decision[]> {
  return query<Decision>(
    `SELECT * FROM (
       SELECT 'photo' AS kind, p.id::text AS id, j.id AS job_id, j.title AS job_title, u.name AS worker_name,
              p.kind AS what, p.review, r.name AS reviewer_name, p.reviewed_at, p.review_note
         FROM job_photos p JOIN jobs j ON j.id = p.job_id
         LEFT JOIN users u ON u.id = p.user_id LEFT JOIN users r ON r.id = p.reviewed_by
        WHERE p.review IN ('approved', 'rejected') AND p.reviewed_at IS NOT NULL
       UNION ALL
       SELECT 'skip', s.id::text, j.id, j.title, u.name, s.step, s.review, r.name, s.reviewed_at, s.review_note
         FROM job_skips s JOIN jobs j ON j.id = s.job_id
         LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users r ON r.id = s.reviewed_by
        WHERE s.review IN ('approved', 'rejected') AND s.reviewed_at IS NOT NULL
     ) d ORDER BY reviewed_at DESC LIMIT $1`,
    [limit],
  );
}
