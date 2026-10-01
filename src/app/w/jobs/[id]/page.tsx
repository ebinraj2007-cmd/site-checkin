import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobSteps } from "@/components/JobSteps";
import { Card, LinkButton, StatusBadge } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { directionsLink } from "@/lib/geo";
import { CODE_MAX_ATTEMPTS, getJob, getJobPhotos, getJobSkips, isCurrentVisit, isLate } from "@/lib/jobs";
import { displayPhone, telLink } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Job" };

export default async function WorkerJobPage(props: PageProps<"/w/jobs/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  const job = await getJob(id);
  if (!job || job.assigned_to !== me.id) notFound();
  const [photos, skips, { timezone: tz }] = await Promise.all([getJobPhotos(job.id), getJobSkips(job.id), getSettings()]);
  const now = new Date();
  // The manager rejected the arrival photo (the worker checks in again), or the leaving
  // photo (the job is open again for a new one).
  const lastArrival = photos.findLast((p) => p.kind === "arrival");
  const lastLeave = photos.findLast((p) => p.kind === "leave" && isCurrentVisit(job, p));
  const why = (note: string) => (note ? ` Their note: “${note}”` : "");
  const rejected =
    job.status === "assigned" && lastArrival?.review === "rejected"
      ? `Your manager didn't accept your arrival photo. Send a new one from the site.${why(lastArrival.review_note)}`
      : job.status === "arrived" && lastLeave?.review === "rejected"
        ? `Your manager didn't accept your leaving photo. Send a new one from the site.${why(lastLeave.review_note)}`
        : null;

  return (
    <div className="space-y-3">
      <Link href="/w" className="text-sm font-semibold text-slate-500">
        ← My jobs
      </Link>
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold tracking-tight">{job.title}</h1>
          <StatusBadge status={job.status} late={isLate(job, now)} />
        </div>
        <dl className="space-y-1.5 text-sm">
          {job.scheduled_at && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-500">When</dt>
              <dd className="font-semibold">{formatDateTime(job.scheduled_at, tz, now)}</dd>
            </div>
          )}
          {job.address && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-500">Where</dt>
              <dd>{job.address}</dd>
            </div>
          )}
          {(job.customer_name || job.customer_phone) && (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-500">Customer</dt>
              <dd>
                {job.customer_name}{" "}
                {job.customer_phone && (
                  <a href={telLink(job.customer_phone)} className="font-semibold text-brand-700">
                    {displayPhone(job.customer_phone)}
                  </a>
                )}
              </dd>
            </div>
          )}
        </dl>
        {job.instructions && <p className="whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{job.instructions}</p>}
        {(job.status === "assigned" || job.status === "arrived") && (
          <LinkButton href={directionsLink({ lat: job.site_lat, lng: job.site_lng })} external variant="secondary" className="w-full">
            Directions in Google Maps
          </LinkButton>
        )}
      </Card>
      <JobSteps
        workerName={me.name}
        timezone={tz}
        alert={rejected}
        skips={skips
          .filter((s) => isCurrentVisit(job, s))
          .map((s) => ({ id: s.id, step: s.step, reason: s.reason, note: s.note, review: s.review, reviewNote: s.review_note }))}
        job={{
          id: job.id,
          title: job.title,
          status: job.status,
          site: { lat: job.site_lat, lng: job.site_lng },
          radius: job.radius_m,
          requireWorkPhotos: job.require_work_photos,
          requireNotes: job.require_notes,
          requireSignature: job.require_signature,
          requireLeavePhoto: job.require_leave_photo,
          requireSelfie: job.require_selfie,
          // Whether a code is needed and accepted; the code itself stays on the server.
          requireCustomerCode: job.require_customer_code && !!job.customer_code,
          codeConfirmed: !!job.code_confirmed_at,
          codeTriesLeft: Math.max(0, CODE_MAX_ATTEMPTS - job.code_attempts),
          notes: job.notes,
          signatureName: job.signature_name,
          signatureUrl: job.signature_file ? `/api/files/${job.signature_file}` : null,
          signedAtText: job.signed_at ? formatDateTime(job.signed_at, tz, now) : null,
          arrivedAtText: job.arrived_at ? formatDateTime(job.arrived_at, tz, now) : null,
          completedAtText: job.completed_at ? formatDateTime(job.completed_at, tz, now) : null,
        }}
        photos={photos
          .filter((p) => isCurrentVisit(job, p))
          .map((p) => ({
            id: p.id,
            kind: p.kind,
            url: `/api/files/${p.file_key}`,
            timeText: formatDateTime(p.created_at, tz, now),
            distance: p.distance_m,
            onSite: p.on_site,
            review: p.review,
            requestReason: p.request_reason,
            reviewNote: p.review_note,
          }))}
      />
    </div>
  );
}
