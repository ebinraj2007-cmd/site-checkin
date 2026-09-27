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

const { query } = await import("@/lib/db");
const { checkLogin, hashPin } = await import("@/lib/auth");

const PHONE = "971501111111";
const PIN = "135790";
const WRONG = "Wrong phone number or PIN.";

beforeAll(async () => {
  await query("INSERT INTO users (name, phone, role, pin_hash) VALUES ('Maya', $1, 'manager', $2)", [
    PHONE,
    await hashPin(PIN),
  ]);
}, 30_000);

describe("checkLogin", () => {
  it("accepts the right PIN and refuses a wrong one", async () => {
    expect(await checkLogin(PHONE, PIN)).toMatchObject({ ok: true, user: { phone: PHONE, role: "manager" } });
    expect(await checkLogin(PHONE, "000000")).toEqual({ ok: false, error: WRONG });
    expect(await checkLogin("971509999999", PIN)).toEqual({ ok: false, error: WRONG });
    await checkLogin(PHONE, PIN); // resets the counter
  });

  it("gives a burst of parallel guesses at most 5 tries, then locks", async () => {
    const guesses = Array.from({ length: 40 }, (_, i) => String(200000 + i));
    const results = await Promise.all(guesses.map((g) => checkLogin(PHONE, g)));
    expect(results.every((r) => !r.ok)).toBe(true);
    const tried = results.filter((r) => !r.ok && r.error === WRONG).length;
    expect(tried).toBeLessThanOrEqual(4); // the 5th try answers "too many"
    expect(results.filter((r) => !r.ok && r.error.startsWith("Too many wrong PINs")).length).toBe(40 - tried);

    // Locked: even the right PIN is refused…
    expect(await checkLogin(PHONE, PIN)).toMatchObject({ ok: false, error: expect.stringContaining("Too many") });
    // …until the lock runs out.
    await query("UPDATE users SET locked_until = now() - interval '1 second' WHERE phone = $1", [PHONE]);
    expect((await checkLogin(PHONE, PIN)).ok).toBe(true);
  }, 30_000);
});
