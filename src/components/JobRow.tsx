import Link from "next/link";
import { isLate, type Job } from "@/lib/job-rules";
import { formatDateTime, formatTime } from "@/lib/time";
import { StatusBadge } from "./ui";

export function jobWhen(job: Job, tz: string, now = new Date()): string {
  if (job.status === "arrived" && job.arrived_at) return `On site since ${formatTime(job.arrived_at, tz)}`;
  if (job.status === "completed" && job.completed_at) return `Done ${formatDateTime(job.completed_at, tz, now)}`;
  if (job.scheduled_at) return formatDateTime(job.scheduled_at, tz, now);
  return "No time set";
}

export function JobRow({
  job,
  href,
  tz,
  now = new Date(),
  showWorker = true,
}: {
  job: Job;
  href: string;
  tz: string;
  now?: Date;
  showWorker?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{job.title}</p>
        <p className="mt-0.5 truncate text-sm text-slate-600">{jobWhen(job, tz, now)}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {[showWorker ? (job.worker_name ?? "Unassigned") : null, job.address].filter(Boolean).join(" · ")}
        </p>
      </div>
      <StatusBadge status={job.status} late={isLate(job, now)} />
    </Link>
  );
}
