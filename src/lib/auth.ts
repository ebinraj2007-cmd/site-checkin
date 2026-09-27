import "server-only";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { query, queryOne } from "./db";

export type Role = "manager" | "worker";
export type SessionUser = { id: string; name: string; phone: string; role: Role };

const SESSION_COOKIE = "sc_session";
const SESSION_DAYS = 180; // workers stay signed in on their phone
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const SCRYPT: ScryptOptions = { N: 16384, r: 8, p: 1 };

function scrypt(secret: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(secret, salt, keylen, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export function isValidPin(pin: string): boolean {
  return /^\d{6,8}$/.test(pin);
}

export function randomPin(): string {
  return String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, "0");
}

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [alg, salt, key] = stored.split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await scrypt(pin, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [
    tokenHash(token),
    userId,
    expires.toISOString(),
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash(token)]);
  store.delete(SESSION_COOKIE);
}

export async function endAllSessions(userId: string) {
  await query("DELETE FROM sessions WHERE user_id = $1", [userId]);
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return queryOne<SessionUser>(
    `SELECT u.id, u.name, u.phone, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [tokenHash(token)],
  );
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireManager(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "manager") redirect("/w");
  return user;
}

export async function hasAnyUser(): Promise<boolean> {
  return (await queryOne("SELECT 1 FROM users LIMIT 1")) !== null;
}

type LoginRow = SessionUser & { pin_hash: string; failed_logins: number };

let dummyHash: Promise<string> | null = null;

// Login with a lockout that holds under parallel requests: each attempt first reserves
// one of MAX_FAILED_LOGINS tries in a single UPDATE, and only then runs the slow PIN
// check. A burst of guesses gets at most that many tries per lock window.
export async function checkLogin(
  phone: string,
  pin: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const wrong = "Wrong phone number or PIN.";
  const tooMany = (minutes: number) => `Too many wrong PINs. Try again in ${minutes} min.`;
  const row = await queryOne<LoginRow>(
    `UPDATE users
        SET failed_logins = CASE WHEN locked_until <= now() THEN 1 ELSE failed_logins + 1 END,
            locked_until = CASE WHEN locked_until <= now() THEN NULL ELSE locked_until END
      WHERE phone = $1 AND active
        AND (failed_logins < $2 OR locked_until <= now())
      RETURNING id, name, phone, role, pin_hash, failed_logins`,
    [phone, MAX_FAILED_LOGINS],
  );
  if (!row) {
    // Unknown number, or no tries left. Spend the same time as a real check either way.
    dummyHash ??= hashPin("000000");
    await verifyPin(pin, await dummyHash);
    const locked = await queryOne<{ locked_until: Date }>(
      `UPDATE users SET locked_until = COALESCE(locked_until, now() + ($2 || ' minutes')::interval)
        WHERE phone = $1 AND active AND failed_logins >= $3
        RETURNING locked_until`,
      [phone, String(LOCK_MINUTES), MAX_FAILED_LOGINS],
    );
    if (!locked) return { ok: false, error: wrong };
    return { ok: false, error: tooMany(Math.max(1, Math.ceil((locked.locked_until.getTime() - Date.now()) / 60_000))) };
  }
  if (!(await verifyPin(pin, row.pin_hash))) {
    if (row.failed_logins < MAX_FAILED_LOGINS) return { ok: false, error: wrong };
    await query(
      `UPDATE users SET locked_until = now() + ($2 || ' minutes')::interval
        WHERE id = $1 AND locked_until IS NULL`,
      [row.id, String(LOCK_MINUTES)],
    );
    return { ok: false, error: tooMany(LOCK_MINUTES) };
  }
  await query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [row.id]);
  return { ok: true, user: { id: row.id, name: row.name, phone: row.phone, role: row.role } };
}
