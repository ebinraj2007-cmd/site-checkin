import "server-only";
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "./auth";

export function fail(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

// Route handler guard: signed in (and a manager, if asked). Returns a Response to send
// back on failure. Mutations must come from this site (session cookies are SameSite=Lax;
// this is the second lock).
export async function apiUser(req: Request, opts: { manager?: boolean } = {}): Promise<SessionUser | Response> {
  if (req.method !== "GET" && !sameOrigin(req)) return fail(403, "Request blocked.");
  const user = await getSessionUser();
  if (!user) return fail(401, "Your login has expired. Log in again.");
  if (opts.manager && user.role !== "manager") return fail(403, "Only managers can do that.");
  return user;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Refuse oversized bodies before reading them (Vercel caps at 4.5 MB; a self-hosted
// server would otherwise buffer whatever it is sent).
export function tooLarge(req: Request, maxBytes: number): boolean {
  return Number(req.headers.get("content-length") ?? 0) > maxBytes;
}

export function numberField(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
