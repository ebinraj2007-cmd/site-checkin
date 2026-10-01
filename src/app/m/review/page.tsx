import type { Metadata } from "next";
import Link from "next/link";
import { PhotoTile } from "@/components/PhotoTile";
import { ReviewForm } from "@/components/ReviewForm";
import { Badge, Card, Empty, PageTitle } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { SKIP_REASONS, SKIP_STEP_LABEL } from "@/lib/jobs";
import { displayPhone, telLink } from "@/lib/phone";
import { photosToReview, recentDecisions, skipsToReview, type PhotoForReview, type SkipForReview } from "@/lib/review";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { reviewPhoto, reviewSkip } from "./actions";

export const metadata: Metadata = { title: "Review" };

const KIND_LABEL = { arrival: "Arrival photo", work: "Work photo", leave: "Leaving photo" } as const;

export default async function ReviewPage() {
  await requireManager();
  const [photos, skips, decisions, { timezone: tz }] = await Promise.all([
    photosToReview(),
    skipsToReview(),
    recentDecisions(),
    getSettings(),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle
        title="Review"
        subtitle="Check-ins sent for your approval and ones with warning signs. They don't count for time on site until you approve them."
      />
      {photos.length + skips.length === 0 && <Empty>Nothing to review. Check-ins that need a look will show up here.</Empty>}
      {photos.map((p) => (
        <PhotoReview key={p.id} photo={p} tz={tz} />
      ))}
      {skips.map((skip) => (
        <SkipReview key={skip.id} skip={skip} tz={tz} />
      ))}
      {decisions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-bold text-slate-800">Recent decisions</h2>
          <Card className="divide-y divide-slate-100 p-0">
            {decisions.map((d) => (
              <Link key={`${d.kind}-${d.id}`} href={`/m/jobs/${d.job_id}`} className="flex items-start gap-3 p-3 text-sm hover:bg-slate-50">
                <Badge tone={d.review === "approved" ? "green" : "red"}>{d.review === "approved" ? "Approved" : "Rejected"}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {d.worker_name ?? "Someone"} ·{" "}
                    {d.kind === "skip"
                      ? `Skipped the ${SKIP_STEP_LABEL[d.what as keyof typeof SKIP_STEP_LABEL] ?? d.what}`
                      : KIND_LABEL[d.what as keyof typeof KIND_LABEL]}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {d.job_title}
                    {d.review_note && ` · “${d.review_note}”`}
                  </p>
                </div>
                <span className="shrink-0 text-right text-xs text-slate-500">
                  {d.reviewer_name}
                  <br />
                  {formatDateTime(d.reviewed_at, tz)}
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function PhotoReview({ photo, tz }: { photo: PhotoForReview; tz: string }) {
  const checkin = photo.kind === "arrival" || photo.kind === "leave";
  const located = photo.lat !== null && photo.lng !== null;
  // Rejecting the arrival photo of a visit still under way sends the worker back to check in.
  const ongoing =
    photo.kind === "arrival" &&
    photo.job_status === "arrived" &&
    !!photo.job_arrived_at &&
    photo.created_at.getTime() >= photo.job_arrived_at.getTime();
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-slate-900">
          {photo.user_name ?? "Someone"} · {KIND_LABEL[photo.kind]}
        </h2>
        <Link href={`/m/jobs/${photo.job_id}`} className="text-sm font-semibold text-brand-700">
          {photo.job_title} →
        </Link>
      </div>
      <PhotoTile photo={photo} tz={tz} radius={photo.radius_m}>
        <ReviewForm
          action={reviewPhoto.bind(null, photo.id)}
          movePin={checkin && located ? { checked: photo.request_reason === "pin_wrong" } : undefined}
          rejectWarning={
            ongoing
              ? `Reject? ${photo.user_name ?? "The worker"} will have to send a new arrival photo from the site.`
              : undefined
          }
        />
      </PhotoTile>
    </Card>
  );
}

function SkipReview({ skip, tz }: { skip: SkipForReview; tz: string }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold text-slate-900">
          {skip.user_name ?? "Someone"} · Skipped the {SKIP_STEP_LABEL[skip.step]}
        </h2>
        <Link href={`/m/jobs/${skip.job_id}`} className="text-sm font-semibold text-brand-700">
          {skip.job_title} →
        </Link>
      </div>
      <p className="text-sm">
        <span className="font-semibold">Reason:</span> {SKIP_REASONS[skip.reason] ?? skip.reason}
        {skip.note && <span className="italic"> “{skip.note}”</span>}
        <span className="text-xs text-slate-500"> · {formatDateTime(skip.created_at, tz)}</span>
      </p>
      {skip.customer_phone && (
        <p className="text-sm text-slate-600">
          Check with the customer first:{" "}
          <a href={telLink(skip.customer_phone)} className="font-semibold text-brand-700">
            {[skip.customer_name, displayPhone(skip.customer_phone)].filter(Boolean).join(", ")}
          </a>
        </p>
      )}
      <ReviewForm action={reviewSkip.bind(null, skip.id)} />
    </Card>
  );
}
