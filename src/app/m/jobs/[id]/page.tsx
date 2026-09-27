import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";
import { JobMap, type MapPhoto } from "@/components/JobMap";
import { PhotoTile } from "@/components/PhotoTile";
import { Alert, Badge, buttonClass, Card, LinkButton, StatusBadge, WhatsAppIcon } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import { requireManager } from "@/lib/auth";
import { directionsLink, formatDistance } from "@/lib/geo";
import { getJob, getJobPhotos, isLate, missingSteps } from "@/lib/jobs";
import { jobMessage } from "@/lib/messages";
import { displayPhone, telLink, whatsappLink } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { formatDateTime, formatDuration, formatTime } from "@/lib/time";
import { getUserRow } from "@/lib/users";
import { cancelJob, reopenJob } from "../../actions";

export const metadata: Metadata = { title: "Job" };

export default async function ManagerJobPage(props: PageProps<"/m/jobs/[id]">) {
  await requireManager();
  const { id } = await props.params;
  const search = await props.searchParams;
  const job = await getJob(id);
  if (!job) notFound();
  const [photos, settings, worker, baseUrl] = await Promise.all([
    getJobPhotos(job.id),
    getSettings(),
    job.assigned_to ? getUserRow(job.assigned_to) : null,
    appUrl(),
  ]);
  const tz = settings.timezone;
  const now = new Date();
  const late = isLate(job, now);
  const arrival = photos.find((p) => p.kind === "arrival");
  const leave = photos.find((p) => p.kind === "leave");
  const work = photos.filter((p) => p.kind === "work");
  const open = job.status === "assigned" || job.status === "arrived";
  const whatsapp = job.worker_phone
    ? whatsappLink(job.worker_phone, jobMessage(job, baseUrl, tz, job.worker_name))
    : null;
  const mapPhotos: MapPhoto[] = photos
    .filter((p) => p.lat !== null && p.lng !== null)
    .map((p) => ({
      lat: p.lat!,
      lng: p.lng!,
      kind: p.kind,
      label: `${{ arrival: "Arrival", work: "Work", leave: "Leaving" }[p.kind]} photo · ${formatTime(p.created_at, tz)}`,
    }));
  const stillNeeded = job.status === "arrived" ? missingSteps(job, photos) : [];
  const onSiteFor = job.arrived_at ? (job.left_at ?? job.completed_at ?? (job.status === "arrived" ? now : null)) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/m/jobs" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
            ← Jobs
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{job.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={job.status} late={late} />
            {late && <Badge tone="red">Due {formatTime(job.scheduled_at!, tz)}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && <LinkButton href={`/m/jobs/${job.id}/edit`} variant="secondary">Edit</LinkButton>}
          {open && (
            <form action={cancelJob.bind(null, job.id)}>
              <ConfirmButton confirm="Cancel this job? The worker will be told.">Cancel job</ConfirmButton>
            </form>
          )}
          {!open && (
            <form action={reopenJob.bind(null, job.id)}>
              <ConfirmButton variant="secondary" confirm="Reopen this job so the worker can continue it?">
                Reopen
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>

      {search.created && (
        <Alert tone={worker?.devices ? "green" : "amber"}>
          {worker?.devices ? (
            <>Job created. {worker.name} gets a notification on their phone.</>
          ) : (
            <>
              Job created. {worker?.name ?? "The worker"} hasn&apos;t turned on job alerts, so send it on WhatsApp
              below.
            </>
          )}
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <Detail label="Worker">
              {job.worker_name ?? "Unassigned"}
              {worker && (
                <span className="ml-2 align-middle">
                  <Badge tone={worker.devices ? "green" : "amber"}>{worker.devices ? "Alerts on" : "Alerts off"}</Badge>
                </span>
              )}
            </Detail>
            {job.worker_phone && (
              <div className="flex flex-wrap gap-2">
                {whatsapp && (
                  <LinkButton href={whatsapp} external variant="whatsapp">
                    <WhatsAppIcon /> Send job on WhatsApp
                  </LinkButton>
                )}
                <a href={telLink(job.worker_phone)} className={buttonClass("secondary")}>
                  Call {displayPhone(job.worker_phone)}
                </a>
              </div>
            )}
            <Detail label="When">{job.scheduled_at ? formatDateTime(job.scheduled_at, tz, now) : "No time set"}</Detail>
            <Detail label="Where">
              {job.address || "Pin on map"}{" "}
              <a
                href={directionsLink({ lat: job.site_lat, lng: job.site_lng })}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 text-sm font-semibold text-brand-700"
              >
                Directions →
              </a>
            </Detail>
            {(job.customer_name || job.customer_phone) && (
              <Detail label="Customer">
                {job.customer_name}
                {job.customer_phone && (
                  <a href={telLink(job.customer_phone)} className="ml-2 font-semibold text-brand-700">
                    {displayPhone(job.customer_phone)}
                  </a>
                )}
              </Detail>
            )}
            {job.instructions && (
              <Detail label="Instructions">
                <span className="whitespace-pre-wrap">{job.instructions}</span>
              </Detail>
            )}
            <Detail label="Must send">
              {[
                "arrival photo",
                job.require_work_photos && "work photos",
                job.require_notes && "notes",
                job.require_signature && "customer signature",
                job.require_leave_photo && "leaving photo",
              ]
                .filter(Boolean)
                .join(", ")}{" "}
              <span className="text-slate-500">(check-in within {formatDistance(job.radius_m)})</span>
            </Detail>
          </Card>
          <JobMap site={{ lat: job.site_lat, lng: job.site_lng }} radius={job.radius_m} photos={mapPhotos} />
        </div>

        <div className="space-y-4">
          <Card className="space-y-4">
            <h2 className="text-base font-bold">Proof from the site</h2>
            {job.status === "cancelled" && <Alert>This job was cancelled.</Alert>}
            {!arrival && job.status !== "cancelled" && (
              <Alert tone={late ? "red" : "slate"}>
                {late
                  ? `Late: ${job.worker_name ?? "the worker"} hasn't checked in. The job was due at ${formatTime(job.scheduled_at!, tz)}.`
                  : "Waiting for the arrival photo."}
              </Alert>
            )}
            {arrival && (
              <Step title="Arrived" time={arrival.created_at} tz={tz}>
                <PhotoTile photo={arrival} tz={tz} radius={job.radius_m} />
              </Step>
            )}
            {work.length > 0 && (
              <Step title={`Work photos (${work.length})`}>
                <div className="grid grid-cols-3 gap-2">
                  {work.map((p) => (
                    <PhotoTile key={p.id} photo={p} tz={tz} radius={job.radius_m} compact />
                  ))}
                </div>
              </Step>
            )}
            {job.notes && (
              <Step title="Notes">
                <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{job.notes}</p>
              </Step>
            )}
            {job.signature_file && (
              <Step title={`Signed by ${job.signature_name}`} time={job.signed_at} tz={tz}>
                {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
                <img
                  src={`/api/files/${job.signature_file}`}
                  alt={`Signature of ${job.signature_name}`}
                  className="h-28 w-full rounded-xl border border-slate-200 bg-white object-contain"
                />
              </Step>
            )}
            {leave && (
              <Step title="Left the site" time={leave.created_at} tz={tz}>
                <PhotoTile photo={leave} tz={tz} radius={job.radius_m} />
              </Step>
            )}
            {job.status === "completed" && !leave && job.completed_at && (
              <Step title="Finished" time={job.completed_at} tz={tz} />
            )}
            {stillNeeded.length > 0 && <Alert tone="amber">Still to send: {stillNeeded.join(", ")}.</Alert>}
            {job.arrived_at && onSiteFor && (
              <p className="text-sm text-slate-600">
                Time on site: <span className="font-semibold">{formatDuration(onSiteFor.getTime() - job.arrived_at.getTime())}</span>
                {job.status === "arrived" && " so far"}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

function Step({
  title,
  time,
  tz,
  children,
}: {
  title: string;
  time?: Date | null;
  tz?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">✓ {title}</h3>
        {time && tz && <span className="text-xs text-slate-500">{formatDateTime(time, tz)}</span>}
      </div>
      {children}
    </div>
  );
}
