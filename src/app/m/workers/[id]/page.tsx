import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobRow } from "@/components/JobRow";
import { Badge, Card, Empty, PageTitle } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { listJobs } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { getUserRow } from "@/lib/users";
import { EditWorkerForm, ResetPinForm } from "./WorkerForms";

export const metadata: Metadata = { title: "Worker" };

export default async function WorkerPage(props: PageProps<"/m/workers/[id]">) {
  const me = await requireManager();
  const { id } = await props.params;
  const worker = await getUserRow(id);
  if (!worker) notFound();
  const [{ timezone }, jobs] = await Promise.all([getSettings(), listJobs({ view: "all", workerId: worker.id, limit: 20 })]);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link href="/m/workers" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Workers
        </Link>
        <PageTitle
          title={worker.name}
          subtitle={
            <span className="flex flex-wrap gap-1.5 pt-1">
              <Badge tone={worker.devices ? "green" : "amber"}>
                {worker.devices
                  ? `Job alerts on (${worker.devices} device${worker.devices === 1 ? "" : "s"})`
                  : "Job alerts off: send jobs on WhatsApp"}
              </Badge>
              {worker.passkeys > 0 && (
                <Badge tone="green">
                  Fingerprint login on ({worker.passkeys} device{worker.passkeys === 1 ? "" : "s"})
                </Badge>
              )}
              {!worker.active && <Badge tone="gray">Inactive</Badge>}
            </span>
          }
        />
      </div>
      <Card>
        <EditWorkerForm
          worker={{ id: worker.id, name: worker.name, phone: worker.phone, role: worker.role, active: worker.active }}
          isMe={worker.id === me.id}
        />
      </Card>
      {worker.id !== me.id && (
        <Card>
          <h2 className="mb-1 text-base font-bold">Forgot PIN / lost phone</h2>
          <p className="mb-3 text-sm text-slate-600">
            A new PIN logs {worker.name} out everywhere and removes their fingerprint logins, so a lost phone can&apos;t
            be used.
          </p>
          <ResetPinForm workerId={worker.id} />
        </Card>
      )}
      <section className="space-y-2">
        <h2 className="text-base font-bold">Recent jobs</h2>
        {jobs.length ? (
          jobs.map((j) => <JobRow key={j.id} job={j} href={`/m/jobs/${j.id}`} tz={timezone} showWorker={false} />)
        ) : (
          <Empty>No jobs yet.</Empty>
        )}
      </section>
    </div>
  );
}
