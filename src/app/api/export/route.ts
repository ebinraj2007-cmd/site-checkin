import { apiUser } from "@/lib/api";
import { appUrl } from "@/lib/app-url";
import { query } from "@/lib/db";
import { listJobs, overlappingVisits, statusLabel } from "@/lib/jobs";
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
  const stats = await query<{ job_id: string; work_photos: number; arrival_distance: number | null }>(
    `SELECT p.job_id,
            count(*) FILTER (WHERE p.kind = 'work')::int AS work_photos,
            max(p.distance_m) FILTER (WHERE p.kind = 'arrival') AS arrival_distance
       FROM job_photos p JOIN jobs j ON j.id = p.job_id
      WHERE p.created_at >= j.arrived_at
      GROUP BY p.job_id`,
  );
  const byJob = new Map(stats.map((s) => [s.job_id, s]));
  const overlapping = new Set(overlaps.map((o) => o.job_id));
  const when = (d: Date | null) => (d ? formatStamp(d, tz) : "");

  const header = [
    "Job", "Status", "Worker", "Customer", "Customer phone", "Address", "Scheduled", "Arrived",
    "Arrival distance (m)", "Left site", "Finished", "Minutes on site", "Overlaps another job",
    "Work photos", "Notes", "Signed by", "Link",
  ];
  const rows = jobs.map((j) => {
    const s = byJob.get(j.id);
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
      // Only arrival photo to leaving photo counts; Finish can be tapped from anywhere.
      j.arrived_at && j.left_at ? Math.round((j.left_at.getTime() - j.arrived_at.getTime()) / 60_000) : "",
      overlapping.has(j.id) ? "yes" : "",
      s?.work_photos ?? 0,
      j.notes,
      j.signature_name,
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
