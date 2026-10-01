import { NextResponse } from "next/server";
import { apiUser, crossSite, fail, readBody } from "@/lib/api";
import { loginOptions, PasskeyError, registrationOptions } from "@/lib/passkeys";

// The challenge for setting up a passkey (logged in) or logging in with one.
export async function POST(req: Request) {
  const body = await readBody(req, 1024);
  const data = (await body?.json().catch(() => null)) as { purpose?: unknown } | null;
  try {
    if (data?.purpose === "login") {
      const blocked = crossSite(req);
      if (blocked) return blocked;
      return NextResponse.json(await loginOptions());
    }
    if (data?.purpose === "register") {
      const user = await apiUser(req);
      if (user instanceof Response) return user;
      return NextResponse.json(await registrationOptions(user));
    }
  } catch (err) {
    if (err instanceof PasskeyError) return fail(400, err.message);
    throw err;
  }
  return fail(400, "Unknown request.");
}
