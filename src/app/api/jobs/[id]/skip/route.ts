import { NextResponse, after } from "next/server";
import { apiWorker, fail, readBody } from "@/lib/api";
import { notifyReview } from "@/lib/checkin-notify";
import { query } from "@/lib/db";
import { getJob, getJobSkips, isCurrentVisit, isSkipped, isSkipReason, SKIP_REASONS, SKIP_STEP_LABEL, type SkipStep } from "@/lib/jobs";

// The customer can't sign or give the code (not there, refuses…): the worker skips the
// step with a reason, and the manager reviews it. The job can be finished meanwhile.
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/skip">) {
  const user = await apiWorker(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "Steps can be skipped while you're on site.");
  const body = await readBody(req, 4096);
  const data = (await body?.json().catch(() => null)) as { step?: unknown; reason?: unknown; note?: unknown } | null;
  const step = data?.step === "signature" || data?.step === "code" ? (data.step as SkipStep) : null;
  if (!step) return fail(400, "Unknown step.");
  if (!isSkipReason(data?.reason)) return fail(400, "Choose why you're skipping it.");
  const reason = data.reason;
  const note = typeof data?.note === "string" ? data.note.trim().slice(0, 300) : "";
  if (reason === "other" && note.length < 3) return fail(400, "Write why you're skipping it.");
  const needed = step === "signature" ? job.require_signature && !job.signature_file : job.require_customer_code && !job.code_confirmed_at;
  if (!needed) return fail(409, `The ${SKIP_STEP_LABEL[step]} isn't needed any more.`);
  const visit = (await getJobSkips(job.id)).filter((s) => isCurrentVisit(job, s));
  if (isSkipped(visit, step)) return NextResponse.json({ ok: true });

  const saved = await query(
    `INSERT INTO job_skips (job_id, user_id, step, reason, note)
     SELECT id, $2, $3, $4, $5 FROM jobs WHERE id = $1 AND status = 'arrived' AND assigned_to = $2 RETURNING id`,
    [job.id, user.id, step, reason, note],
  );
  if (!saved.length) return fail(409, "This job changed in the meantime.");
  after(() =>
    notifyReview(job, user.name, user.id, `Skipped the ${SKIP_STEP_LABEL[step]}: ${SKIP_REASONS[reason]}${note ? ` (“${note}”)` : ""}`),
  );
  return NextResponse.json({ ok: true });
}
