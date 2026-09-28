import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { JobRow } from "@/components/JobRow";
import { buttonClass, Empty, LinkButton, PageTitle } from "@/components/ui";
import { WorkerFilter } from "@/components/WorkerFilter";
import { requireManager } from "@/lib/auth";
import { listJobs, type Job } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { dayKey, formatDay } from "@/lib/time";
import { listUsers } from "@/lib/users";

export const metadata: Metadata = { title: "Jobs" };

const PAGE = 200;

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "done", label: "Done" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function JobsPage(props: PageProps<"/m/jobs">) {
  await requireManager();
  const params = await props.searchParams;
  const view: View = VIEWS.some((v) => v.key === params.view) ? (params.view as View) : "open";
  const worker = typeof params.worker === "string" ? params.worker : undefined;
  const [{ timezone }, found, users] = await Promise.all([
    getSettings(),
    listJobs({ view, workerId: worker, limit: PAGE + 1 }),
    listUsers(),
  ]);
  const jobs = found.slice(0, PAGE);
  const now = new Date();
  const groups = groupByDay(jobs, view, timezone, now);
  const query = (next: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, worker, ...next })) if (v) q.set(k, v);
    return q.toString();
  };

  return (
    <div>
      <PageTitle
        title="Jobs"
        action={
          <a href={`/api/export?${query({})}`} className={buttonClass("secondary")}>
            Export CSV
          </a>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl border border-slate-300 bg-white p-0.5">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/m/jobs?${query({ view: v.key })}`}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                v.key === view ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <Suspense>
          <WorkerFilter workers={users.map((u) => ({ id: u.id, name: u.name }))} />
        </Suspense>
      </div>

      {jobs.length === 0 ? (
        <Empty>
          No jobs here.{" "}
          <span className="mt-3 block">
            <LinkButton href="/m/jobs/new">+ New job</LinkButton>
          </span>
        </Empty>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key} className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{g.label}</h2>
              {g.jobs.map((j) => (
                <JobRow key={j.id} job={j} href={`/m/jobs/${j.id}`} tz={timezone} now={now} />
              ))}
            </section>
          ))}
          {found.length > PAGE && (
            <p className="text-sm text-slate-500">
              Showing {PAGE} jobs. Choose a worker to narrow the list, or use Export CSV to get all of them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function groupByDay(jobs: Job[], view: View, tz: string, now: Date) {
  const groups: { key: string; label: string; jobs: Job[] }[] = [];
  for (const job of jobs) {
    const date = view === "done" ? job.completed_at : (job.scheduled_at ?? (view === "open" ? null : job.created_at));
    const key = date ? dayKey(date, tz) : "none";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, label: date ? formatDay(date, tz, now) : "No date", jobs: [] };
      groups.push(g);
    }
    g.jobs.push(job);
  }
  return groups;
}
