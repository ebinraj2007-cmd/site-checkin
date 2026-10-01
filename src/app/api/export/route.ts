import { apiUser } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { query } from "@/lib/db";
import { FLAGS, listJobs, overlappingVisits, SKIP_REASONS, SKIP_STEP_LABEL, statusLabel, type Flag, type JobSkip } from "@/lib/jobs";
import { displayPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { dayKey, formatStamp } from "@/lib/time";

const VIEWS = ["open", "done", "cancelled", "all"] as const;

// Spreadsheet of jobs with check-in times, for payroll and customer records.
export async function GET(req: Request) {
  const user = await apiUser(req, { manager: true });
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const view = VIEWS.find((v) => v === params.get("view")) ?? "all";
  const worker = params.get("worker") ?? undefined;
  const [{ timezone: tz }, jobs, baseUrl, overlaps] = await Promise.all([
    getSettings(),
    listJobs({ view, workerId: worker, limit: 10_000 }),
    appUrl(),
    overlappingVisits(),
  ]);
  // The current visit's photos (a reopened job starts a new visit).
  const stats = await query<{
    job_id: string;
    work_photos: number;
    arrival_distance: number | null;
    checkins_count: boolean | null;
    pending: boolean;
    rejected: boolean;
    approved: boolean;
    flags: Flag[][] | null;
  }>(
    `SELECT p.job_id,
            count(*) FILTER (WHERE p.kind = 'work' AND p.review <> 'rejected')::int AS work_photos,
            max(p.distance_m) FILTER (WHERE p.kind = 'arrival') AS arrival_distance,
            bool_and(p.review IN ('none', 'approved')) FILTER (WHERE p.kind IN ('arrival', 'leave')) AS checkins_count,
            bool_or(p.review = 'pending') AS pending,
            bool_or(p.review = 'rejected') AS rejected,
            bool_or(p.review = 'approved') AS approved,
            jsonb_agg(p.flags) FILTER (WHERE p.flags <> '[]'::jsonb) AS flags
       FROM job_photos p JOIN jobs j ON j.id = p.job_id
      WHERE p.created_at >= j.arrived_at
      GROUP BY p.job_id`,
  );
  const byJob = new Map(stats.map((s) => [s.job_id, s]));
  // The current visit's skipped customer steps.
  const skips = await query<Pick<JobSkip, "job_id" | "step" | "reason" | "note" | "review">>(
    `SELECT s.job_id, s.step, s.reason, s.note, s.review
       FROM job_skips s JOIN jobs j ON j.id = s.job_id
      WHERE s.created_at >= j.arrived_at
      ORDER BY s.created_at`,
  );
  const skipsByJob = new Map<string, typeof skips>();
  for (const skip of skips) skipsByJob.set(skip.job_id, [...(skipsByJob.get(skip.job_id) ?? []), skip]);
  const overlapping = new Set(overlaps.map((o) => o.job_id));
  const when = (d: Date | null) => (d ? formatStamp(d, tz) : "");

  const header = [
    "Job", "Status", "Worker", "Customer", "Customer phone", "Address", "Scheduled", "Arrived",
    "Arrival distance (m)", "Left site", "Finished", "Minutes on site", "Overlaps another job",
    "Review", "Warning signs", "Work photos", "Notes", "Customer code", "Signed by", "Skipped steps", "Link",
  ];
  const rows = jobs.map((j) => {
    const s = byJob.get(j.id);
    const jobSkips = skipsByJob.get(j.id) ?? [];
    const skipped = jobSkips.map(
      (x) =>
        `${SKIP_STEP_LABEL[x.step]}: ${SKIP_REASONS[x.reason] ?? x.reason}${x.note ? ` (${x.note})` : ""} [${x.review === "pending" ? "waiting" : x.review}]`,
    );
    const skipReview = (r: string) => jobSkips.some((x) => x.review === r);
    const review =
      s?.pending || skipReview("pending")
        ? "waiting"
        : s?.rejected || skipReview("rejected")
          ? "rejected"
          : s?.approved || skipReview("approved")
            ? "approved"
            : "";
    const codeSkipped = jobSkips.some((x) => x.step === "code" && x.review !== "rejected");
    const warnings = [...new Set((s?.flags ?? []).flat().map((f) => FLAGS[f.code]?.label ?? f.code))];
    return [
      j.title,
      statusLabel(j.status),
      j.worker_name ?? "",
      j.customer_name,
      // No leading "+": spreadsheets would read it as a formula.
      j.customer_phone ? displayPhone(j.customer_phone).replace(/^\+/, "") : "",
      j.address,
      when(j.scheduled_at),
      when(j.arrived_at),
      s?.arrival_distance != null ? Math.round(s.arrival_distance) : "",
      when(j.left_at),
      when(j.completed_at),
      // Only arrival photo to leaving photo counts (Finish can be tapped from anywhere), and
      // only once both photos are accepted.
      j.arrived_at && j.left_at && s?.checkins_count ? Math.round((j.left_at.getTime() - j.arrived_at.getTime()) / 60_000) : "",
      overlapping.has(j.id) ? "yes" : "",
      review,
      warnings.join("; "),
      s?.work_photos ?? 0,
      j.notes,
      j.require_customer_code ? (j.code_confirmed_at ? "given" : codeSkipped ? "skipped" : "not given") : "",
      j.signature_name,
      skipped.join("; "),
      `${baseUrl}/m/jobs/${j.id}`,
    ];
  });
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jobs-${view}-${dayKey(new Date(), tz)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

// Quote for CSV, and defuse values Excel would run as formulas.
function cell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
