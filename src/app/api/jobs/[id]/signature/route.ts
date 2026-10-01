import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { apiWorker, fail, readBody } from "@/lib/api";
import { query } from "@/lib/db";
import { imageInfo } from "@/lib/image-check";
import { getJob } from "@/lib/jobs";
import { putFile, StorageError } from "@/lib/storage";

const MAX_BYTES = 1024 * 1024;

// The customer's signature, once per job.
export async function POST(req: Request, ctx: RouteContext<"/api/jobs/[id]/signature">) {
  const user = await apiWorker(req);
  if (user instanceof Response) return user;
  const job = await getJob((await ctx.params).id);
  if (!job || job.assigned_to !== user.id) return fail(404, "This job isn't assigned to you.");
  if (job.status !== "arrived") return fail(409, "The customer can sign while you're on site.");
  if (job.signature_file) return fail(409, "The customer has already signed.");
  const body = await readBody(req, MAX_BYTES + 64 * 1024);
  if (!body) return fail(413, "The signature is too large.");
  const form = await body.formData().catch(() => null);
  const name = String(form?.get("name") ?? "").trim().slice(0, 120);
  const file = form?.get("signature");
  if (!name) return fail(400, "Enter the customer's name.");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) return fail(400, "The signature didn't arrive.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (imageInfo(bytes)?.type !== "image/png") return fail(400, "The signature didn't arrive.");
  const key = `signatures/${job.id}/${randomUUID()}.png`;
  try {
    await putFile(key, bytes, "image/png");
  } catch (err) {
    if (err instanceof StorageError) return fail(507, err.message);
    throw err;
  }
  const saved = await query(
    `UPDATE jobs SET signature_name = $2, signature_file = $3, signed_at = now(), updated_at = now()
      WHERE id = $1 AND status = 'arrived' AND assigned_to = $4 AND signature_file IS NULL RETURNING id`,
    [job.id, name, key, user.id],
  );
  if (!saved.length) return fail(409, "This job changed in the meantime.");
  return NextResponse.json({ ok: true });
}
