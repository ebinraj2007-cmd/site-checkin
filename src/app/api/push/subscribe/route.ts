import { NextResponse } from "next/server";
import { apiUser, fail, tooLarge } from "@/lib/api";
import { deleteSubscription, isPushSubscription, saveSubscription } from "@/lib/push";

export async function POST(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  if (tooLarge(req, 8 * 1024)) return fail(413, "Too large.");
  const body = await req.json().catch(() => null);
  if (!isPushSubscription(body)) return fail(400, "That isn't a push subscription from a supported browser.");
  await saveSubscription(user.id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  if (typeof body?.endpoint !== "string") return fail(400, "Missing endpoint.");
  await deleteSubscription(user.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
