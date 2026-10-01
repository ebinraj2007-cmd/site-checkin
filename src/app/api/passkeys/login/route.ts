import { NextResponse } from "next/server";
import { crossSite, fail, readBody } from "@/lib/api";
import { startSession, trustDevice } from "@/lib/auth";
import { finishLogin, PasskeyError } from "@/lib/passkeys";

// Logs in with a passkey: no phone number or PIN needed.
export async function POST(req: Request) {
  const blocked = crossSite(req);
  if (blocked) return blocked;
  const body = await readBody(req, 64 * 1024);
  const data = await body?.json().catch(() => null);
  if (!data || typeof data !== "object") return fail(400, "Malformed response.");
  let user;
  try {
    user = await finishLogin(data);
  } catch (err) {
    if (err instanceof PasskeyError) return fail(401, err.message);
    throw err;
  }
  await startSession(user.id, "passkey");
  await trustDevice(user.id);
  return NextResponse.json({ ok: true, redirect: user.role === "manager" ? "/m" : "/w" });
}
