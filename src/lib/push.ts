import "server-only";
import webpush from "web-push";
import { query, queryOne } from "./db";

export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type PushSubscriptionJSON = { endpoint: string; keys: { p256dh: string; auth: string } };

type Vapid = { publicKey: string; privateKey: string };
let vapidPromise: Promise<Vapid> | null = null;

// VAPID keys identify this server to the browsers' push services. Use the env vars if
// set; otherwise generate a pair once and keep it in the database (zero setup).
function vapid(): Promise<Vapid> {
  vapidPromise ??= loadVapid().catch((err) => {
    vapidPromise = null;
    throw err;
  });
  return vapidPromise;
}

async function loadVapid(): Promise<Vapid> {
  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) return { publicKey, privateKey };
  const stored = await readStoredVapid();
  if (stored) return stored;
  await query(
    "INSERT INTO settings (key, value) VALUES ('vapid_keys', $1) ON CONFLICT (key) DO NOTHING",
    [JSON.stringify(webpush.generateVAPIDKeys())],
  );
  // Re-read: if two servers raced, both use the pair that was stored first.
  const saved = await readStoredVapid();
  if (!saved) throw new Error("Could not store push keys");
  return saved;
}

async function readStoredVapid(): Promise<Vapid | null> {
  const row = await queryOne<{ value: string }>("SELECT value FROM settings WHERE key = 'vapid_keys'");
  return row ? (JSON.parse(row.value) as Vapid) : null;
}

function vapidSubject(): string {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : "mailto:admin@example.com";
}

export async function getVapidPublicKey(): Promise<string> {
  return (await vapid()).publicKey;
}

// The server POSTs to whatever endpoint a browser hands over, so only accept the
// browser vendors' push services (Chrome/Android, Firefox, Safari/iPhone, Edge).
const PUSH_HOSTS = ["googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function isPushSubscription(value: unknown): value is PushSubscriptionJSON {
  const v = value as PushSubscriptionJSON;
  if (typeof v?.endpoint !== "string" || v.endpoint.length > 2000) return false;
  if (typeof v.keys?.p256dh !== "string" || typeof v.keys?.auth !== "string") return false;
  // p256dh is an uncompressed P-256 public key (65 bytes), auth a 16-byte secret.
  if (base64UrlBytes(v.keys.p256dh) !== 65 || base64UrlBytes(v.keys.auth) !== 16) return false;
  let url: URL;
  try {
    url = new URL(v.endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
  );
}

function base64UrlBytes(value: string): number {
  return /^[A-Za-z0-9_-]+={0,2}$/.test(value) ? Buffer.from(value, "base64url").length : -1;
}

export async function saveSubscription(userId: string, sub: PushSubscriptionJSON) {
  await query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function deleteSubscription(userId: string, endpoint: string) {
  await query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint]);
}

export async function deleteAllSubscriptions(userId: string) {
  await query("DELETE FROM push_subscriptions WHERE user_id = $1", [userId]);
}

export async function subscriptionCount(userId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1",
    [userId],
  );
  return row?.n ?? 0;
}

// Returns how many devices accepted the message. Dead subscriptions are removed.
export async function notifyUsers(userIds: string[], payload: PushPayload): Promise<number> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return 0;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${placeholders})`,
    ids,
  );
  if (!subs.length) return 0;
  const { publicKey, privateKey } = await vapid();
  const body = JSON.stringify(payload);
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
          vapidDetails: { subject: vapidSubject(), publicKey, privateKey },
          TTL: 24 * 3600,
          urgency: "high",
          timeout: 10_000,
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the browser dropped it. 401/403: it was made for other server keys.
        if (status === 404 || status === 410 || status === 401 || status === 403) {
          await query("DELETE FROM push_subscriptions WHERE endpoint = $1", [s.endpoint]);
        } else {
          console.error(`Push to ${new URL(s.endpoint).host} failed:`, status ?? (err as Error).message);
        }
      }
    }),
  );
  return sent;
}

export async function notifyManagers(payload: PushPayload, exceptUserId?: string): Promise<number> {
  const managers = await query<{ id: string }>(
    "SELECT id FROM users WHERE role = 'manager' AND active AND id <> $1",
    [exceptUserId ?? "00000000-0000-0000-0000-000000000000"],
  );
  return notifyUsers(
    managers.map((m) => m.id),
    payload,
  );
}
