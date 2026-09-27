import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { query } from "@/lib/db";
import { getJob } from "@/lib/jobs";
import { putFile, sniffImage } from "@/lib/storage";

export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/signature">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "The customer can sign while you're on site.");
  const form = await req.formData().catch(() => null);
  const name = String(form?.get("name") ?? "").trim().slice(0, 120);
  const file = form?.get("signature");
  if (!name) return fail(400, "Enter the customer's name.");
  if (!(file instanceof File) || file.size === 0 || file.size > 1024 * 1024) return fail(400, "The signature didn't arrive.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffImage(bytes) !== "image/png") return fail(400, "The signature didn't arrive.");
  const key = `signatures/${job.id}/${randomUUID()}.png`;
  await putFile(key, bytes, "image/png");
  await query(
    "UPDATE jobs SET signature_name = $2, signature_file = $3, signed_at = now(), updated_at = now() WHERE id = $1",
    [job.id, name, key],
  );
  return NextResponse.json({ ok: true });
}
