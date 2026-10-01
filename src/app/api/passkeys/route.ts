import { NextResponse } from "next/server";
import { apiUser, fail, readBody } from "@/lib/api";
import { removePasskeys } from "@/lib/passkeys";
import { passkeysRequired } from "@/lib/settings";

// Removes one of your own passkeys ({ id }) or all of them ({ all: true }). While the
// company requires fingerprint login, only a manager can take a worker's away (by
// resetting their PIN), or the worker could switch back to a PIN they shared.
export async function DELETE(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  if (user.role === "worker" && (await passkeysRequired())) {
    return fail(403, "Your company requires fingerprint or face login. Ask your manager if you need it reset.");
  }
  const body = await readBody(req, 4096);
  const data = (await body?.json().catch(() => null)) as { id?: unknown; all?: unknown } | null;
  if (data?.all === true) await removePasskeys(user.id);
  else if (typeof data?.id === "string" && data.id.length <= 1400) await removePasskeys(user.id, data.id);
  else return fail(400, "Unknown passkey.");
  return NextResponse.json({ ok: true });
}
