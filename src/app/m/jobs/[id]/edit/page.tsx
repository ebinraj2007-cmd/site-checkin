import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JobForm } from "@/components/JobForm";
import { PageTitle } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { displayPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { dateToLocalInput } from "@/lib/time";
import { workerOptions } from "@/lib/users";
import { updateJob } from "../../../actions";

export const metadata: Metadata = { title: "Edit job" };

export default async function EditJobPage(props: PageProps<"/m/jobs/[id]/edit">) {
  await requireManager();
  const { id } = await props.params;
  const [job, settings, workers] = await Promise.all([getJob(id), getSettings(), workerOptions()]);
  if (!job) notFound();
  // Keep a deactivated worker selectable so saving doesn't silently unassign.
  if (job.assigned_to && !workers.some((w) => w.id === job.assigned_to)) {
    workers.push({ id: job.assigned_to, name: `${job.worker_name} (inactive)`, role: "worker", alerts: false });
  }
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Edit job" subtitle={job.title} />
      <JobForm
        action={updateJob.bind(null, job.id)}
        workers={workers}
        fallbackCenter={null}
        timezone={settings.timezone}
        submitLabel="Save changes"
        defaults={{
          title: job.title,
          assignedTo: job.assigned_to ?? "",
          scheduledAt: job.scheduled_at ? dateToLocalInput(job.scheduled_at, settings.timezone) : "",
          address: job.address,
          point: { lat: job.site_lat, lng: job.site_lng },
          radius: job.radius_m,
          customerName: job.customer_name,
          customerPhone: job.customer_phone ? displayPhone(job.customer_phone) : "",
          instructions: job.instructions,
          requireLeavePhoto: job.require_leave_photo,
          requireWorkPhotos: job.require_work_photos,
          requireNotes: job.require_notes,
          requireSignature: job.require_signature,
        }}
      />
    </div>
  );
}
