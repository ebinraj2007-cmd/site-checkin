import type { Metadata } from "next";
import Link from "next/link";
import { JobForm } from "@/components/JobForm";
import { Alert, PageTitle } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { lastJobSite } from "@/lib/jobs";
import { getSettings } from "@/lib/settings";
import { workerOptions } from "@/lib/users";
import { createJob } from "../../actions";

export const metadata: Metadata = { title: "New job" };

export default async function NewJobPage() {
  const me = await requireManager();
  const [settings, workers, lastSite] = await Promise.all([getSettings(), workerOptions(), lastJobSite()]);
  const onlyMe = workers.every((w) => w.id === me.id);
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="New job" subtitle="The worker gets a notification, and must send a photo from the site when they arrive." />
      {onlyMe && (
        <div className="mb-4">
          <Alert tone="amber">
            You haven&apos;t added any workers yet.{" "}
            <Link href="/m/workers" className="font-semibold underline">
              Add workers
            </Link>{" "}
            first, or assign this job to yourself to try it out.
          </Alert>
        </div>
      )}
      <JobForm
        action={createJob}
        workers={workers}
        fallbackCenter={lastSite}
        timezone={settings.timezone}
        submitLabel="Create job & notify worker"
        defaults={{
          title: "",
          assignedTo: "",
          scheduledAt: "",
          address: "",
          point: null,
          radius: settings.defaultRadius,
          customerName: "",
          customerPhone: "",
          instructions: "",
          requireLeavePhoto: true, // gives the job a verified time on site
          requireWorkPhotos: false,
          requireNotes: false,
          requireSignature: false,
          requireSelfie: false,
          requireCustomerCode: false,
        }}
      />
    </div>
  );
}
