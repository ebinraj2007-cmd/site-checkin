import { NextResponse, after } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { notifyFinished } from "@/lib/checkin-notify";
import { query } from "@/lib/db";
import { getJob, getJobPhotos, missingSteps } from "@/lib/jobs";

// Finish a job that doesn't need a leaving photo (otherwise that photo finishes it).
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/finish">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "This job isn't in progress.");
  if (job.require_leave_photo) return fail(409, "Take the leaving photo to finish this job.");
  const missing = missingSteps(job, await getJobPhotos(job.id));
  if (missing.length) return fail(409, `Before finishing, add: ${missing.join(", ")}.`);
  const done = await query(
    "UPDATE jobs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1 AND status = 'arrived' RETURNING id",
    [job.id],
  );
  if (!done.length) return fail(409, "This job changed in the meantime. Reload the page.");
  after(() => notifyFinished(job, user.name, new Date(), user.id));
  return NextResponse.json({ ok: true });
}
