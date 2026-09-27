import type { Metadata } from "next";
import { JobRow } from "@/components/JobRow";
import { PushSetup } from "@/components/PushSetup";
import { Empty } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { jobsForWorker } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { dayRange } from "@/lib/time";

export const metadata: Metadata = { title: "My jobs" };

export default async function MyJobs() {
  const me = await requireUser();
  const [{ timezone }, jobs] = await Promise.all([getSettings(), jobsForWorker(me.id)]);
  const now = new Date();
  const [, endOfToday] = dayRange(timezone, now);
  const onSite = jobs.filter((j) => j.status === "arrived");
  const today = jobs.filter((j) => j.status === "assigned" && (!j.scheduled_at || j.scheduled_at < endOfToday));
  const later = jobs.filter((j) => j.status === "assigned" && j.scheduled_at && j.scheduled_at >= endOfToday);
  const done = jobs.filter((j) => j.status === "completed");
  const row = (j: (typeof jobs)[number]) => (
    <JobRow key={j.id} job={j} href={`/w/jobs/${j.id}`} tz={timezone} now={now} showWorker={false} />
  );
  return (
    <div className="space-y-5">
      <PushSetup compact />
      {onSite.length > 0 && <Group title="You're on site">{onSite.map(row)}</Group>}
      <Group title="Today">{today.length ? today.map(row) : <Empty>No jobs for today yet. New jobs will show up here.</Empty>}</Group>
      {later.length > 0 && <Group title="Coming up">{later.map(row)}</Group>}
      {done.length > 0 && <Group title="Done this week">{done.map(row)}</Group>}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
