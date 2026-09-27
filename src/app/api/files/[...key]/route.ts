import { apiUser, fail } from "@/lib/api";
import { getJob } from "@/lib/jobs";
import { fileResponse } from "@/lib/storage";

const KEY = /^(photos|signatures)\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

// Photos and signatures, only for managers and the worker the job belongs to.
export async function GET(req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const key = (await ctx.params).key.join("/");
  const match = key.match(KEY);
  if (!match) return fail(404, "Not found.");
  if (user.role !== "manager") {
    const job = await getJob(match[2]);
    if (!job || job.assigned_to !== user.id) return fail(404, "Not found.");
  }
  return fileResponse(key);
}
