import type { Metadata } from "next";
import Link from "next/link";
import { JobRow } from "@/components/JobRow";
import { Alert, Badge, Card, Empty, LinkButton, PageTitle } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { formatDistance } from "@/lib/geo";
import { countCompletedBetween, isLate, listJobs, recentCheckins } from "@/lib/jobs";
import { reviewCount } from "@/lib/review";
import { getSettings } from "@/lib/settings";
import { dayRange, formatDateTime, formatLongDate } from "@/lib/time";
import { listUsers } from "@/lib/users";

export const metadata: Metadata = { title: "Today" };

export default async function Dashboard() {
  const me = await requireManager();
  const { timezone } = await getSettings();
  const now = new Date();
  const [start, end] = dayRange(timezone, now);
  const [open, doneToday, checkins, users, toReview] = await Promise.all([
    listJobs({ view: "open", limit: 500 }),
    countCompletedBetween(start, end),
    recentCheckins(8),
    listUsers(),
    reviewCount(),
  ]);

  const late = open.filter((j) => isLate(j, now));
  const onSite = open.filter((j) => j.status === "arrived");
  const upcoming = open.filter((j) => j.status === "assigned" && !isLate(j, now));
  const toStartToday = upcoming.filter((j) => j.scheduled_at && j.scheduled_at < end).length;
  const workers = users.filter((u) => u.active && u.id !== me.id);
  const firstRun = open.length === 0 && checkins.length === 0;

  return (
    <div className="space-y-6">
      <PageTitle title="Today" subtitle={formatLongDate(now, timezone)} />

      {firstRun && <GettingStarted hasWorkers={workers.length > 0} />}

      {toReview > 0 && (
        <Alert tone="amber">
          <Link href="/m/review" className="font-semibold underline">
            {toReview === 1 ? "1 check-in needs" : `${toReview} check-ins need`} your review →
          </Link>{" "}
          Sent for approval, or with warning signs. They don&apos;t count until you approve them.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Late" value={late.length} tone={late.length ? "red" : "slate"} />
        <Stat label="On site now" value={onSite.length} tone="amber" />
        <Stat label="Still to start today" value={toStartToday} tone="blue" />
        <Stat label="Done today" value={doneToday} tone="green" />
      </div>

      {late.length > 0 && (
        <Section title="Needs attention" hint="Not checked in 15 min after the start time">
          {late.map((j) => (
            <JobRow key={j.id} job={j} href={`/m/jobs/${j.id}`} tz={timezone} now={now} />
          ))}
        </Section>
      )}

      {onSite.length > 0 && (
        <Section title="On site now">
          {onSite.map((j) => (
            <JobRow key={j.id} job={j} href={`/m/jobs/${j.id}`} tz={timezone} now={now} />
          ))}
        </Section>
      )}

      <Section title="Coming up" action={<Link href="/m/jobs" className="text-sm font-semibold text-brand-700">All jobs →</Link>}>
        {upcoming.length ? (
          upcoming.slice(0, 10).map((j) => <JobRow key={j.id} job={j} href={`/m/jobs/${j.id}`} tz={timezone} now={now} />)
        ) : (
          <Empty>Nothing waiting to start.</Empty>
        )}
      </Section>

      <Section title="Latest check-ins">
        {checkins.length ? (
          <Card className="divide-y divide-slate-100 p-0">
            {checkins.map((c) => (
              <Link key={c.id} href={`/m/jobs/${c.job_id}`} className="flex items-center gap-3 p-3 hover:bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
                <img src={`/api/files/${c.file_key}`} alt="" className="h-12 w-12 shrink-0 rounded-lg bg-slate-200 object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {c.worker_name ?? "Someone"} {c.kind === "arrival" ? "arrived" : "left"}
                    {c.review === "pending" && (
                      <span className="ml-1.5 align-middle">
                        <Badge tone="amber">Needs review</Badge>
                      </span>
                    )}
                    {c.review === "rejected" && (
                      <span className="ml-1.5 align-middle">
                        <Badge tone="red">Rejected</Badge>
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {c.title}
                    {c.distance_m !== null && ` · ${formatDistance(c.distance_m)} from site`}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-slate-500">{formatDateTime(c.created_at, timezone, now)}</span>
              </Link>
            ))}
          </Card>
        ) : (
          <Empty>Arrival and leaving photos will show up here.</Empty>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "red" | "amber" | "blue" | "green" | "slate" }) {
  const tones = {
    red: "text-red-700",
    amber: "text-amber-700",
    blue: "text-sky-700",
    green: "text-emerald-700",
    slate: "text-slate-900",
  };
  return (
    <Card className="p-3.5">
      <p className={`text-3xl font-bold tabular-nums ${value ? tones[tone] : "text-slate-400"}`}>{value}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-500">{label}</p>
    </Card>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-slate-800">
          {title}
          {hint && <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function GettingStarted({ hasWorkers }: { hasWorkers: boolean }) {
  return (
    <Card className="border-brand-200 bg-brand-50">
      <h2 className="font-bold text-brand-900">Get started in 3 steps</h2>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-brand-900">
        <li>
          <Link href="/m/workers" className="font-semibold underline">
            Add your workers
          </Link>{" "}
          and send each one their login on WhatsApp. {hasWorkers && "✓"}
        </li>
        <li>Ask them to open the link, add it to the home screen and turn on job alerts.</li>
        <li>
          <Link href="/m/jobs/new" className="font-semibold underline">
            Create a job
          </Link>
          . They get a notification, and send a GPS-stamped photo when they arrive.
        </li>
      </ol>
      <div className="mt-3">
        <LinkButton href={hasWorkers ? "/m/jobs/new" : "/m/workers"}>{hasWorkers ? "Create a job" : "Add workers"}</LinkButton>
      </div>
    </Card>
  );
}
