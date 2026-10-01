import "server-only";
import { formatDistance } from "./geo";
import type { Job } from "./job-rules";
import { notifyManagers } from "./push";
import { formatDuration } from "./time";

// Tell managers when someone reaches or leaves a site. `review`: why the photo waits for
// their review, if it does; the notification then opens the review list.
export function notifyArrival(
  job: Pick<Job, "id" | "title">,
  workerName: string,
  distance: number | null,
  workerId: string,
  review: string | null = null,
) {
  return notifyManagers(
    {
      title: review ? `${workerName} arrived · needs your review` : `${workerName} arrived`,
      body: [job.title, distance !== null ? `${formatDistance(distance)} from site` : null, review]
        .filter(Boolean)
        .join(" · "),
      url: review ? "/m/review" : `/m/jobs/${job.id}`,
      tag: `job-${job.id}`,
    },
    workerId,
  );
}

// `leftAt` is the leaving photo's time; a job finished without one has no time on site.
export function notifyFinished(
  job: Pick<Job, "id" | "title" | "arrived_at">,
  workerName: string,
  workerId: string,
  leftAt: Date | null,
  review: string | null = null,
) {
  const onSite =
    job.arrived_at && leftAt ? `on site ${formatDuration(leftAt.getTime() - job.arrived_at.getTime())}` : null;
  return notifyManagers(
    {
      title: review ? `${workerName} finished · needs your review` : `${workerName} finished`,
      body: [job.title, onSite, review].filter(Boolean).join(" · "),
      url: review ? "/m/review" : `/m/jobs/${job.id}`,
      tag: `job-${job.id}`,
    },
    workerId,
  );
}

// Something else waits for the managers' review (a flagged work photo, a skipped step).
export function notifyReview(job: Pick<Job, "id" | "title">, workerName: string, workerId: string, what: string) {
  return notifyManagers(
    { title: `Needs your review: ${workerName}`, body: `${job.title} · ${what}`, url: "/m/review", tag: `review-${job.id}` },
    workerId,
  );
}
