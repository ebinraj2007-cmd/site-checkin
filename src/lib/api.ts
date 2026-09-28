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

function tooLarge(req: Request, maxBytes: number): boolean {
  return Number(req.headers.get("content-length") ?? 0) > maxBytes;
}

// Reads a request body, refusing it once it passes maxBytes: by Content-Length first, and
// by counting the bytes as they arrive, since a chunked upload doesn't send a length
// (Vercel caps bodies at 4.5 MB; a self-hosted server would buffer whatever it is sent).
// Returns the body to call .formData() or .json() on, or null if it was too large.
export async function readBody(req: Request, maxBytes: number): Promise<Pick<Response, "formData" | "json"> | null> {
  if (tooLarge(req, maxBytes)) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(bytes, { headers: { "Content-Type": req.headers.get("content-type") ?? "" } });
}

export function numberField(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
