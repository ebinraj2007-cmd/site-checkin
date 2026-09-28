import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real database (PGlite) and the real login code; only Next's request APIs are stubbed.
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

process.env.PGLITE_DIR = path.join(os.tmpdir(), `site-checkin-unit-${process.pid}-${Date.now()}`);
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { query, queryOne } = await import("@/lib/db");
const { checkLogin, hashPin, WRONG_LOGIN } = await import("@/lib/auth");

const PHONE = "971501111111";
const PIN = "135790";
const OTHER_PHONE = "971502222222";
const OWN_DEVICE = "device-token-of-maya";
const OTHER_DEVICE = "device-token-of-ravi";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

beforeAll(async () => {
  const hash = await hashPin(PIN);
  const [maya] = await query<{ id: string }>(
    "INSERT INTO users (name, phone, role, pin_hash) VALUES ('Maya', $1, 'manager', $2) RETURNING id",
    [PHONE, hash],
  );
  const [ravi] = await query<{ id: string }>(
    "INSERT INTO users (name, phone, role, pin_hash) VALUES ('Ravi', $1, 'worker', $2) RETURNING id",
    [OTHER_PHONE, hash],
  );
  await query("INSERT INTO login_devices (token_hash, user_id) VALUES ($1, $2), ($3, $4)", [
    sha256(OWN_DEVICE),
    maya.id,
    sha256(OTHER_DEVICE),
    ravi.id,
  ]);
}, 30_000);

async function unlock() {
  await query("UPDATE users SET failed_logins = 0, locked_until = NULL");
  await query("UPDATE login_devices SET failed_logins = 0, locked_until = NULL");
}

describe("checkLogin", () => {
  it("accepts the right PIN and gives one answer to every failure", async () => {
    expect(await checkLogin(PHONE, PIN)).toMatchObject({ ok: true, user: { phone: PHONE, role: "manager" } });
    expect(await checkLogin(PHONE, "000000")).toEqual({ ok: false, error: WRONG_LOGIN, locked: false });
    // An unknown number reads the same as a wrong PIN.
    expect(await checkLogin("971509999999", PIN)).toEqual({ ok: false, error: WRONG_LOGIN, locked: false });
    await unlock();
  });

  it("gives a burst of parallel guesses at most 5 tries, then locks", async () => {
    const guesses = Array.from({ length: 40 }, (_, i) => String(200000 + i));
    const results = await Promise.all(guesses.map((g) => checkLogin(PHONE, g)));
    expect(results.every((r) => !r.ok && r.error === WRONG_LOGIN)).toBe(true);
    const row = await queryOne<{ failed_logins: number; locked_until: Date | null }>(
      "SELECT failed_logins, locked_until FROM users WHERE phone = $1",
      [PHONE],
    );
    expect(row!.failed_logins).toBe(5);
    expect(row!.locked_until).not.toBeNull();

    // Locked: even the right PIN is refused…
    expect(await checkLogin(PHONE, PIN)).toMatchObject({ ok: false, locked: true });
    // …until the lock runs out.
    await query("UPDATE users SET locked_until = now() - interval '1 second' WHERE phone = $1", [PHONE]);
    expect((await checkLogin(PHONE, PIN)).ok).toBe(true);
    await unlock();
  }, 30_000);

  it("lets the owner's own browser in while guesses from elsewhere have locked the number", async () => {
    for (let i = 0; i < 6; i++) await checkLogin(PHONE, "111111");
    expect(await checkLogin(PHONE, PIN)).toMatchObject({ ok: false, locked: true });
    expect(await checkLogin(PHONE, PIN, "some-other-browser")).toMatchObject({ ok: false, locked: true });
    expect(await checkLogin(PHONE, PIN, OWN_DEVICE)).toMatchObject({ ok: true, user: { phone: PHONE } });
    await unlock();
  }, 30_000);

  it("gives a known browser only 5 tries of its own", async () => {
    for (let i = 0; i < 5; i++) await checkLogin(PHONE, "222222", OWN_DEVICE);
    expect(await checkLogin(PHONE, PIN, OWN_DEVICE)).toMatchObject({ ok: false, locked: true });
    // The number's own counter is untouched: other browsers can still log in.
    expect((await checkLogin(PHONE, PIN)).ok).toBe(true);
    await unlock();
  }, 30_000);

  it("doesn't treat another person's browser as known", async () => {
    for (let i = 0; i < 5; i++) await checkLogin(PHONE, "333333", OTHER_DEVICE);
    expect(await checkLogin(PHONE, PIN, OWN_DEVICE)).toMatchObject({ ok: true });
    expect(await checkLogin(PHONE, PIN, OTHER_DEVICE)).toMatchObject({ ok: false, locked: true });
    await unlock();
  }, 30_000);
});
