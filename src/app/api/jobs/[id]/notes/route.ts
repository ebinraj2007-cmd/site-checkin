import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { query } from "@/lib/db";
import { getJob } from "@/lib/jobs";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/notes">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "Notes can be added while you're on site.");
  const body = (await req.json().catch(() => null)) as { notes?: unknown } | null;
  if (typeof body?.notes !== "string") return fail(400, "Missing notes.");
  const notes = body.notes.trim().slice(0, 4000);
  await query("UPDATE jobs SET notes = $2, updated_at = now() WHERE id = $1", [job.id, notes]);
  return NextResponse.json({ ok: true, notes });
}
