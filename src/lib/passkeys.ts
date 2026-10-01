import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { markSessionPasskey, type LoginUser, type SessionUser } from "./auth";
import { query, queryOne, transaction } from "./db";
import { displayPhone } from "./phone";
import { getSettings } from "./settings";
import { ALGORITHMS, fromBase64Url, toBase64Url, verifyAssertion, verifyRegistration, WebAuthnError } from "./webauthn";

// Fingerprint / face login with passkeys. A passkey lives on the person's phone (or their
// phone maker's account) and only unlocks with their fingerprint, face or phone PIN, so
// unlike a PIN it can't be passed to a colleague. With "workers must log in with
// fingerprint or face" on, a worker who has a passkey can't log in with their PIN (see
// checkLogin); a PIN reset by the manager (lost phone) removes their passkeys.

export { WebAuthnError as PasskeyError };

const CHALLENGE_MINUTES = 5;
const MAX_PASSKEYS = 10;
const TOO_LATE = "This took too long. Try again.";

// This site as passkeys see it: the host name, and the origin the browser reports.
export async function relyingParty(): Promise<{ rpId: string; origin: string }> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto")?.split(",")[0] ?? (local ? "http" : "https");
  return { rpId: host.replace(/:\d+$/, ""), origin: `${proto}://${host}` };
}

// A user ID for the passkey that isn't their phone number: the account's UUID.
const userHandle = (userId: string) => toBase64Url(Buffer.from(userId.replace(/-/g, ""), "hex"));

// ---------- Login challenges ----------
// Handed out to anyone before they log in, so they cost nothing to store: a random nonce
// and an expiry, signed with a key only the server has. A challenge is written down only
// once it has logged someone in, so it can't be used twice.

let keyPromise: Promise<Buffer> | null = null;

function challengeKey(): Promise<Buffer> {
  keyPromise ??= (async () => {
    await query("INSERT INTO settings (key, value) VALUES ('passkey_challenge_key', $1) ON CONFLICT (key) DO NOTHING", [
      randomBytes(32).toString("hex"),
    ]);
    // Re-read: if two servers raced, both use the key stored first.
    const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'passkey_challenge_key'");
    return Buffer.from(row!.value, "hex");
  })().catch((err) => {
    keyPromise = null;
    throw err;
  });
  return keyPromise;
}

async function signedChallenge(): Promise<string> {
  const head = Buffer.alloc(24);
  randomBytes(16).copy(head);
  head.writeBigUInt64BE(BigInt(Date.now() + CHALLENGE_MINUTES * 60_000), 16);
  const mac = createHmac("sha256", await challengeKey()).update(head).digest();
  return Buffer.concat([head, mac]).toString("base64url");
}

async function checkSignedChallenge(challenge: unknown): Promise<{ challenge: string; expires: Date }> {
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{75}$/.test(challenge)) throw new WebAuthnError(TOO_LATE);
  const bytes = Buffer.from(challenge, "base64url");
  if (bytes.length !== 56) throw new WebAuthnError(TOO_LATE);
  const mac = createHmac("sha256", await challengeKey()).update(bytes.subarray(0, 24)).digest();
  if (!timingSafeEqual(mac, bytes.subarray(24))) throw new WebAuthnError(TOO_LATE);
  const expires = Number(bytes.readBigUInt64BE(16));
  if (expires < Date.now()) throw new WebAuthnError(TOO_LATE);
  return { challenge, expires: new Date(expires) };
}

export async function loginOptions() {
  const rp = await relyingParty();
  // No list of passkeys: the phone offers the ones it has for this site.
  return { publicKey: { challenge: await signedChallenge(), rpId: rp.rpId, timeout: 120_000, userVerification: "required" as const } };
}

type CredentialBody = {
  challenge?: unknown;
  challengeId?: unknown;
  credential?: { id?: unknown; type?: unknown; response?: Record<string, unknown> };
};

// Checks a passkey login and returns who it is. Inactive people are refused.
export async function finishLogin(body: CredentialBody): Promise<LoginUser> {
  const { challenge, expires } = await checkSignedChallenge(body.challenge);
  const id = body.credential?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,1400}$/.test(id)) throw new WebAuthnError("Malformed response.");
  const key = await queryOne<LoginUser & { public_key: string; algorithm: number; sign_count: number }>(
    `SELECT u.id, u.name, u.phone, u.role, p.public_key, p.algorithm, p.sign_count::float8 AS sign_count
       FROM passkeys p JOIN users u ON u.id = p.user_id
      WHERE p.id = $1 AND u.active`,
    [id],
  );
  if (!key) throw new WebAuthnError("This fingerprint login isn't set up here any more. Log in with your PIN, then set it up again.");
  const response = body.credential?.response ?? {};
  if (response.userHandle != null && !Buffer.from(fromBase64Url(response.userHandle)).equals(Buffer.from(fromBase64Url(userHandle(key.id))))) {
    throw new WebAuthnError("This passkey belongs to someone else.");
  }
  const result = verifyAssertion(response, { challenge, ...(await relyingParty()) }, {
    jwk: JSON.parse(key.public_key),
    alg: key.algorithm,
    signCount: key.sign_count,
  });
  await query("DELETE FROM webauthn_challenges WHERE expires_at < now()");
  const fresh = await query(
    `INSERT INTO webauthn_challenges (challenge, purpose, expires_at) VALUES ($1, 'login', $2)
     ON CONFLICT (challenge) DO NOTHING RETURNING id`,
    [challenge, expires.toISOString()],
  );
  if (!fresh.length) throw new WebAuthnError("This login was used already. Try again.");
  await query("UPDATE passkeys SET sign_count = $2, backed_up = $3, last_used_at = now() WHERE id = $1", [
    id,
    result.signCount,
    result.backedUp,
  ]);
  return { id: key.id, name: key.name, phone: key.phone, role: key.role };
}

// ---------- Setting up a passkey ----------

export async function registrationOptions(user: SessionUser) {
  const [rp, { companyName }, existing] = await Promise.all([
    relyingParty(),
    getSettings(),
    query<{ id: string; transports: string }>("SELECT id, transports FROM passkeys WHERE user_id = $1", [user.id]),
  ]);
  const challenge = randomBytes(32).toString("base64url");
  // One open setup per person: a new one replaces the last.
  await query("DELETE FROM webauthn_challenges WHERE expires_at < now() OR (user_id = $1 AND purpose = 'register')", [user.id]);
  const row = await queryOne<{ id: string }>(
    `INSERT INTO webauthn_challenges (challenge, user_id, purpose, expires_at)
     VALUES ($1, $2, 'register', now() + ($3 || ' minutes')::interval) RETURNING id`,
    [challenge, user.id, String(CHALLENGE_MINUTES)],
  );
  return {
    challengeId: row!.id,
    publicKey: {
      challenge,
      rp: { id: rp.rpId, name: companyName },
      user: { id: userHandle(user.id), name: displayPhone(user.phone) || user.phone, displayName: user.name },
      pubKeyCredParams: ALGORITHMS.map((alg) => ({ type: "public-key" as const, alg })),
      timeout: 120_000,
      attestation: "none" as const,
      authenticatorSelection: {
        authenticatorAttachment: "platform" as const,
        residentKey: "required" as const,
        requireResidentKey: true,
        userVerification: "required" as const,
      },
      // A phone that already has one for this person isn't offered again.
      excludeCredentials: existing.map((c) => ({
        type: "public-key" as const,
        id: c.id,
        transports: c.transports ? c.transports.split(",") : undefined,
      })),
    },
  };
}

export async function finishRegistration(user: SessionUser, body: CredentialBody, label: string) {
  const valid = typeof body.challengeId === "string" && /^[0-9a-f-]{36}$/i.test(body.challengeId);
  const row = valid
    ? await queryOne<{ challenge: string }>(
        `DELETE FROM webauthn_challenges
          WHERE id = $1 AND purpose = 'register' AND user_id = $2 AND expires_at > now() RETURNING challenge`,
        [body.challengeId, user.id],
      )
    : null;
  if (!row) throw new WebAuthnError(TOO_LATE);
  const response = body.credential?.response ?? {};
  const created = verifyRegistration(response, { challenge: row.challenge, ...(await relyingParty()) });
  if (body.credential?.id !== created.id) throw new WebAuthnError("Malformed response.");
  const transports = Array.isArray(response.transports)
    ? response.transports.filter((t): t is string => typeof t === "string" && /^[a-z-]{1,20}$/.test(t)).slice(0, 8)
    : [];
  await transaction(async (q) => {
    const [{ n }] = await q.query<{ n: number }>("SELECT count(*)::int AS n FROM passkeys WHERE user_id = $1", [user.id]);
    if (n >= MAX_PASSKEYS) throw new WebAuthnError(`You already have ${MAX_PASSKEYS} fingerprint logins. Remove one first.`);
    const saved = await q.query(
      `INSERT INTO passkeys (id, user_id, public_key, algorithm, sign_count, transports, backed_up, label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING RETURNING id`,
      [created.id, user.id, JSON.stringify(created.jwk), created.alg, created.signCount, transports.join(","), created.backedUp, label],
    );
    if (!saved.length) throw new WebAuthnError("This passkey is already set up.");
  });
  // This browser just proved it holds the passkey: its session counts as a passkey login.
  await markSessionPasskey();
}

export type PasskeyRow = { id: string; label: string; created_at: Date; last_used_at: Date | null };

export async function listPasskeys(userId: string): Promise<PasskeyRow[]> {
  return query<PasskeyRow>(
    "SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );
}

// Removes one passkey (or all of them). Without any, the person logs in with their PIN.
export async function removePasskeys(userId: string, id?: string) {
  if (id) await query("DELETE FROM passkeys WHERE user_id = $1 AND id = $2", [userId, id]);
  else await query("DELETE FROM passkeys WHERE user_id = $1", [userId]);
}

// A name for the device a passkey was made on, from its browser's description.
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows computer";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Linux/.test(ua)) return "Linux computer";
  return "Device";
}
