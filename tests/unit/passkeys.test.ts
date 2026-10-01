import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { b64, RP, SoftPasskey } from "./soft-passkey";

// Passkey setup and login end to end on a real database (PGlite), with a software passkey
// standing in for the phone. Only Next's request APIs are stubbed.
vi.mock("server-only", () => ({}));
// The browser's cookies: a session token when a test sets one.
const jar = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name === "sc_session" && jar.session ? { value: jar.session } : undefined),
    set: () => {},
  })),
  headers: vi.fn(async () => new Headers({ host: RP.rpId, "x-forwarded-proto": "https" })),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

process.env.PGLITE_DIR = path.join(os.tmpdir(), `site-checkin-passkeys-${process.pid}-${Date.now()}`);
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { query } = await import("@/lib/db");
const { checkLogin, getSessionUser, hashPin, USE_PASSKEY } = await import("@/lib/auth");
const { finishLogin, finishRegistration, loginOptions, registrationOptions, removePasskeys } = await import("@/lib/passkeys");
const { setPasskeysRequired } = await import("@/lib/settings");

const PIN = "246810";
const ravi = { id: "", name: "Ravi", phone: "971502222222", role: "worker" as const, notice_version: 1 };
const sara = { id: "", name: "Sara", phone: "971503333333", role: "worker" as const, notice_version: 1 };
const phone = new SoftPasskey();

async function register(user: typeof ravi, passkey: SoftPasskey) {
  const options = await registrationOptions(user);
  const response = passkey.register(options.publicKey.challenge);
  await finishRegistration(user, { challengeId: options.challengeId, credential: { id: b64(passkey.id), type: "public-key", response } }, "Android phone");
  return options;
}

async function login(passkey: SoftPasskey, userHandle?: string | null, challenge?: string) {
  const options = await loginOptions();
  const signed = challenge ?? options.publicKey.challenge;
  const response = { ...passkey.login(signed), userHandle };
  return { body: { challenge: signed, credential: { id: b64(passkey.id), type: "public-key", response } } };
}

const pinWorks = async (user: typeof ravi) => (await checkLogin(user.phone, PIN)).ok;

beforeAll(async () => {
  const hash = await hashPin(PIN);
  for (const user of [ravi, sara]) {
    const [row] = await query<{ id: string }>(
      "INSERT INTO users (name, phone, role, pin_hash) VALUES ($1, $2, 'worker', $3) RETURNING id",
      [user.name, user.phone, hash],
    );
    user.id = row.id;
  }
  await setPasskeysRequired(true);
}, 30_000);

describe("passkeys", () => {
  it("are set up for this site, for the person logged in", async () => {
    const options = await register(ravi, phone);
    expect(options.publicKey.rp.id).toBe(RP.rpId);
    expect(options.publicKey.user.displayName).toBe("Ravi");
    expect(options.publicKey.authenticatorSelection.userVerification).toBe("required");
    // The same phone isn't offered a second one.
    expect((await registrationOptions(ravi)).publicKey.excludeCredentials.map((c) => c.id)).toEqual([b64(phone.id)]);
  });

  it("switch the PIN off for workers when the company asks for fingerprint login", async () => {
    expect(await checkLogin(ravi.phone, PIN)).toEqual({ ok: false, error: USE_PASSKEY, locked: false });
    // Workers without a passkey keep using their PIN.
    expect(await pinWorks(sara)).toBe(true);
    // A wrong PIN still gets the usual answer.
    expect(await checkLogin(ravi.phone, "000000")).toMatchObject({ ok: false, locked: false });
    await query("UPDATE users SET failed_logins = 0, locked_until = NULL");
  });

  it("log the right person in, once per challenge", async () => {
    const handle = Buffer.from(ravi.id.replace(/-/g, ""), "hex").toString("base64url");
    const { body } = await login(phone, handle);
    expect(await finishLogin(body)).toEqual({ id: ravi.id, name: "Ravi", phone: ravi.phone, role: "worker" });
    // The same answer again: its counter didn't move on.
    await expect(finishLogin(body)).rejects.toThrow("copied");

    // Synced passkeys don't count, so it's the used-up challenge that stops a replay.
    const synced = new SoftPasskey("es256", false);
    await register(sara, synced);
    const replay = (await login(synced, null)).body;
    expect((await finishLogin(replay)).id).toBe(sara.id);
    await expect(finishLogin(replay)).rejects.toThrow("used already");
  });

  it("only accept challenges the server made, while they're fresh", async () => {
    const { challenge } = (await loginOptions()).publicKey;
    const forged = Buffer.from(challenge, "base64url");
    forged[0] ^= 1;
    await expect(finishLogin((await login(phone, null, forged.toString("base64url"))).body)).rejects.toThrow("took too long");
    await expect(finishLogin((await login(phone, null, "not-a-challenge")).body)).rejects.toThrow("took too long");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await expect(finishLogin((await login(phone, null, challenge)).body)).rejects.toThrow("took too long");
    vi.useRealTimers();
  });

  it("refuse a passkey claiming to be someone else", async () => {
    const saraHandle = Buffer.from(sara.id.replace(/-/g, ""), "hex").toString("base64url");
    const { body } = await login(phone, saraHandle);
    await expect(finishLogin(body)).rejects.toThrow("someone else");
  });

  it("refuse an unknown passkey and an inactive person", async () => {
    await expect(finishLogin((await login(new SoftPasskey(), null)).body)).rejects.toThrow("isn't set up here");
    await query("UPDATE users SET active = false WHERE id = $1", [ravi.id]);
    await expect(finishLogin((await login(phone, null)).body)).rejects.toThrow("isn't set up here");
    await query("UPDATE users SET active = true WHERE id = $1", [ravi.id]);
  });

  it("let the PIN work again when the last one is removed, or the company stops asking", async () => {
    await removePasskeys(ravi.id);
    expect(await pinWorks(ravi)).toBe(true);
    await register(ravi, new SoftPasskey());
    expect(await pinWorks(ravi)).toBe(false);
    await setPasskeysRequired(false);
    expect(await pinWorks(ravi)).toBe(true);
    await setPasskeysRequired(true);
    expect(await pinWorks(ravi)).toBe(false);
  });

  it("end PIN logins made before, but not the one that set the passkey up", async () => {
    const hash = (t: string) => createHash("sha256").update(t).digest("hex");
    for (const [token, method] of [["pin-on-a-friends-phone", "pin"], ["own-phone", "pin"]] as const) {
      await query("INSERT INTO sessions (token_hash, user_id, expires_at, method) VALUES ($1, $2, now() + interval '1 day', $3)", [
        hash(token),
        sara.id,
        method,
      ]);
    }
    await removePasskeys(sara.id);
    jar.session = "pin-on-a-friends-phone";
    expect((await getSessionUser())?.id).toBe(sara.id);
    // Sara sets up fingerprint login on her own phone…
    jar.session = "own-phone";
    await register(sara, new SoftPasskey());
    expect((await getSessionUser())?.id).toBe(sara.id);
    // …and the PIN login on the other phone stops working.
    jar.session = "pin-on-a-friends-phone";
    expect(await getSessionUser()).toBeNull();
    await setPasskeysRequired(false);
    expect((await getSessionUser())?.id).toBe(sara.id);
    await setPasskeysRequired(true);
    jar.session = undefined;
  });

  it("never switch off a manager's PIN", async () => {
    await query("UPDATE users SET role = 'manager' WHERE id = $1", [ravi.id]);
    expect(await pinWorks(ravi)).toBe(true);
    await query("UPDATE users SET role = 'worker' WHERE id = $1", [ravi.id]);
  });
});
