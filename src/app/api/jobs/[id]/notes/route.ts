import { NextResponse } from "next/server";
import { apiUser, fail, tooLarge } from "@/lib/api";
import { query } from "@/lib/db";
import { getJob } from "@/lib/jobs";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/notes">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  if (tooLarge(req, 64 * 1024)) return fail(413, "The notes are too long.");
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "Notes can be added while you're on site.");
  const body = (await req.json().catch(() => null)) as { notes?: unknown } | null;
  if (typeof body?.notes !== "string") return fail(400, "Missing notes.");
  const notes = body.notes.trim().slice(0, 4000);
  const saved = await query(
    "UPDATE jobs SET notes = $2, updated_at = now() WHERE id = $1 AND status = 'arrived' AND assigned_to = $3 RETURNING id",
    [job.id, notes, user.id],
  );
  if (!saved.length) return fail(409, "This job changed in the meantime. Reload the page.");
  return NextResponse.json({ ok: true, notes });
}
