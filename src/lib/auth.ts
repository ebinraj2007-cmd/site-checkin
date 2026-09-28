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
const DEVICE_COOKIE = "sc_device"; // survives logout; see checkLogin
const DEVICE_DAYS = 400; // the longest browsers keep a cookie
const MAX_DEVICES = 10;
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const secureCookies = process.env.NODE_ENV === "production";

// The one answer to every failed login: it doesn't reveal which numbers have an account.
export const WRONG_LOGIN = `Wrong phone number or PIN. After ${MAX_FAILED_LOGINS} wrong tries, the number is locked for ${LOCK_MINUTES} minutes.`;
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
    secure: secureCookies,
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

// Logs this person out everywhere except the browser making the request.
export async function endOtherSessions(userId: string) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  await query("DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", [userId, token ? tokenHash(token) : ""]);
}

export async function deviceToken(): Promise<string | null> {
  return (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
}

// Remembers this browser as one this person logs in on (see checkLogin), keeping their
// most recent few.
export async function trustDevice(userId: string) {
  const current = await deviceToken();
  if (current) {
    const known = await query(
      "UPDATE login_devices SET last_login_at = now() WHERE token_hash = $1 AND user_id = $2 RETURNING token_hash",
      [tokenHash(current), userId],
    );
    if (known.length) return;
  }
  const token = randomBytes(32).toString("base64url");
  await query("INSERT INTO login_devices (token_hash, user_id) VALUES ($1, $2)", [tokenHash(token), userId]);
  await query(
    `DELETE FROM login_devices WHERE user_id = $1 AND token_hash NOT IN (
       SELECT token_hash FROM login_devices WHERE user_id = $1 ORDER BY last_login_at DESC LIMIT $2)`,
    [userId, MAX_DEVICES],
  );
  (await cookies()).set(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_DAYS * 86_400,
  });
}

// Forgets the browsers this person logged in on (e.g. a lost phone), except the one
// making the request if `keepThisOne`.
export async function forgetDevices(userId: string, { keepThisOne = false } = {}) {
  const current = keepThisOne ? await deviceToken() : null;
  await query("DELETE FROM login_devices WHERE user_id = $1 AND token_hash <> $2", [
    userId,
    current ? tokenHash(current) : "",
  ]);
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
export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string; locked: boolean };

// A count of wrong PINs with a lock. `reserve` takes one try (null: unknown number, or
// none left), `lock` starts the lock once the tries are used up, `reset` clears it.
type Counter = {
  reserve(): Promise<LoginRow | null>;
  lock(): Promise<boolean>;
  reset(): Promise<void>;
};

const LOCK_INTERVAL = `($2 || ' minutes')::interval`;

// Shared by every browser that hasn't logged in to this number before.
function numberCounter(phone: string): Counter {
  return {
    reserve: () =>
      queryOne<LoginRow>(
        `UPDATE users
            SET failed_logins = CASE WHEN locked_until <= now() THEN 1 ELSE failed_logins + 1 END,
                locked_until = CASE WHEN locked_until <= now() THEN NULL ELSE locked_until END
          WHERE phone = $1 AND active
            AND (failed_logins < $2 OR locked_until <= now())
          RETURNING id, name, phone, role, pin_hash, failed_logins`,
        [phone, MAX_FAILED_LOGINS],
      ),
    lock: async () =>
      (
        await query(
          `UPDATE users SET locked_until = COALESCE(locked_until, now() + ${LOCK_INTERVAL})
            WHERE phone = $1 AND active AND failed_logins >= $3 RETURNING id`,
          [phone, String(LOCK_MINUTES), MAX_FAILED_LOGINS],
        )
      ).length > 0,
    reset: async () => {
      await query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE phone = $1", [phone]);
    },
  };
}

// A browser this person has logged in on before has a counter of its own.
function deviceCounter(device: string): Counter {
  return {
    reserve: () =>
      queryOne<LoginRow>(
        `UPDATE login_devices d
            SET failed_logins = CASE WHEN d.locked_until <= now() THEN 1 ELSE d.failed_logins + 1 END,
                locked_until = CASE WHEN d.locked_until <= now() THEN NULL ELSE d.locked_until END
           FROM users u
          WHERE d.token_hash = $1 AND u.id = d.user_id AND u.active
            AND (d.failed_logins < $2 OR d.locked_until <= now())
          RETURNING u.id, u.name, u.phone, u.role, u.pin_hash, d.failed_logins`,
        [device, MAX_FAILED_LOGINS],
      ),
    lock: async () =>
      (
        await query(
          `UPDATE login_devices SET locked_until = COALESCE(locked_until, now() + ${LOCK_INTERVAL})
            WHERE token_hash = $1 AND failed_logins >= $3 RETURNING token_hash`,
          [device, String(LOCK_MINUTES), MAX_FAILED_LOGINS],
        )
      ).length > 0,
    reset: async () => {
      await query("UPDATE login_devices SET failed_logins = 0, locked_until = NULL WHERE token_hash = $1", [device]);
    },
  };
}

let dummyHash: Promise<string> | null = null;

// Phone + PIN login with a lockout that holds under parallel requests: each attempt first
// reserves one of MAX_FAILED_LOGINS tries in a single UPDATE, and only then runs the slow
// PIN check, so a burst of guesses gets at most that many tries per lock window.
// A browser that has logged in to this number before (its sc_device cookie) uses its own
// counter: guessing from elsewhere can lock the number, but not its owner's own phone.
export async function checkLogin(phone: string, pin: string, device: string | null = null): Promise<LoginResult> {
  const deviceHash = device ? tokenHash(device) : null;
  const known =
    deviceHash !== null &&
    (await queryOne(
      "SELECT 1 FROM login_devices d JOIN users u ON u.id = d.user_id WHERE d.token_hash = $1 AND u.phone = $2",
      [deviceHash, phone],
    )) !== null;
  const counter = known && deviceHash ? deviceCounter(deviceHash) : numberCounter(phone);
  const row = await counter.reserve();
  if (!row) {
    // Unknown number, or no tries left. Spend the same time as a real check either way.
    dummyHash ??= hashPin("000000");
    await verifyPin(pin, await dummyHash);
    return { ok: false, error: WRONG_LOGIN, locked: await counter.lock() };
  }
  if (!(await verifyPin(pin, row.pin_hash))) {
    const locked = row.failed_logins >= MAX_FAILED_LOGINS;
    if (locked) await counter.lock();
    return { ok: false, error: WRONG_LOGIN, locked };
  }
  await counter.reset();
  return { ok: true, user: { id: row.id, name: row.name, phone: row.phone, role: row.role } };
}
