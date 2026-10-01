import { NextResponse, after } from "next/server";
import { apiUser, fail, readBody } from "@/lib/api";
import { deviceLabel, finishRegistration, PasskeyError } from "@/lib/passkeys";
import { notifyManagers } from "@/lib/push";

// Saves the passkey the phone just made for the logged-in person. Managers are told when
// a worker adds one, so a passkey set up on someone else's phone gets noticed.
export async function POST(req: Request) {
  const user = await apiUser(req);
  if (user instanceof Response) return user;
  const body = await readBody(req, 64 * 1024);
  const data = await body?.json().catch(() => null);
  if (!data || typeof data !== "object") return fail(400, "Malformed response.");
  const label = deviceLabel(req.headers.get("user-agent"));
  try {
    await finishRegistration(user, data, label);
  } catch (err) {
    if (err instanceof PasskeyError) return fail(400, err.message);
    throw err;
  }
  if (user.role === "worker") {
    after(() =>
      notifyManagers(
        { title: `${user.name} set up fingerprint login`, body: `On a device: ${label}`, url: `/m/workers/${user.id}` },
        user.id,
      ),
    );
  }
  return NextResponse.json({ ok: true });
}
