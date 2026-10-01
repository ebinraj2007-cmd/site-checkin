import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiWorker, fail, readBody } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { CODE_MAX_ATTEMPTS, getJob } from "@/lib/jobs";

const NO_TRIES_LEFT = "Too many wrong codes. If the customer can't give it, skip this step and say why.";

// The worker types the code the customer gives them at the site. The code itself never
// reaches the worker's phone; each visit gets a few tries.
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/code">) {
  const user = await apiWorker(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "The customer code can be entered while you're on site.");
  if (!job.require_customer_code || !job.customer_code) return fail(409, "This job doesn't need a customer code.");
  if (job.code_confirmed_at) return NextResponse.json({ ok: true });
  const body = await readBody(req, 1024);
  const data = (await body?.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof data?.code === "string" ? data.code.replace(/\s/g, "") : "";
  if (!/^\d{4}$/.test(code)) return fail(400, "Enter the 4-digit code from the customer.");

  // Take a try first, so a burst of guesses can't get past the limit.
  const tried = await queryOne<{ code_attempts: number }>(
    `UPDATE jobs SET code_attempts = code_attempts + 1
      WHERE id = $1 AND status = 'arrived' AND assigned_to = $2 AND code_confirmed_at IS NULL AND code_attempts < $3
      RETURNING code_attempts`,
    [job.id, user.id, CODE_MAX_ATTEMPTS],
  );
  if (!tried) return fail(429, NO_TRIES_LEFT);
  if (!timingSafeEqual(Buffer.from(code), Buffer.from(job.customer_code.padStart(4, "0").slice(0, 4)))) {
    const left = CODE_MAX_ATTEMPTS - tried.code_attempts;
    return fail(422, left > 0 ? `That code is wrong. ${left} ${left === 1 ? "try" : "tries"} left.` : NO_TRIES_LEFT, { left });
  }
  // The count keeps only the wrong tries.
  await query(
    `UPDATE jobs SET code_confirmed_at = now(), code_attempts = code_attempts - 1, updated_at = now()
      WHERE id = $1 AND code_confirmed_at IS NULL`,
    [job.id],
  );
  return NextResponse.json({ ok: true });
}
