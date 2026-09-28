import "server-only";
import { formatDistance } from "./geo";
import type { Job } from "./job-rules";
import { notifyManagers } from "./push";
import { formatDuration } from "./time";

// Tell managers when someone reaches or leaves a site.
export function notifyArrival(job: Pick<Job, "id" | "title">, workerName: string, distance: number | null, workerId: string) {
  return notifyManagers(
    {
      title: `${workerName} arrived`,
      body: `${job.title}${distance !== null ? ` · ${formatDistance(distance)} from site` : ""}`,
      url: `/m/jobs/${job.id}`,
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
) {
  const onSite =
    job.arrived_at && leftAt ? ` · on site ${formatDuration(leftAt.getTime() - job.arrived_at.getTime())}` : "";
  return notifyManagers(
    { title: `${workerName} finished`, body: `${job.title}${onSite}`, url: `/m/jobs/${job.id}`, tag: `job-${job.id}` },
    workerId,
  );
}
