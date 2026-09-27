import "server-only";
import { query, queryOne } from "./db";
import { env } from "./env";

// Photos and signatures. Two places they can live:
//  - Supabase Storage (private bucket) when SUPABASE_URL + a service key are set.
//  - The `files` table in the app's own database: nothing else to set up, fine for a
//    small team, but it grows the database (~0.3 MB per photo).
// If a Supabase upload fails, the file goes to the database instead, so a storage
// hiccup never loses a check-in. Reads look in the database first, then Supabase.

type SupabaseEnv = { url: string; key: string; bucket: string };

function supabaseEnv(): SupabaseEnv | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SECRET_KEY");
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key, bucket: process.env.SUPABASE_BUCKET || "site-checkin" };
}

export function storageKind(): "supabase" | "database" {
  return supabaseEnv() ? "supabase" : "database";
}

function supabaseHeaders(env: SupabaseEnv): Record<string, string> {
  // New-style secret keys (sb_secret_...) go in `apikey` only; legacy JWT keys also as Bearer.
  const headers: Record<string, string> = { apikey: env.key };
  if (env.key.startsWith("eyJ")) headers.Authorization = `Bearer ${env.key}`;
  return headers;
}

let bucketReady: Promise<void> | null = null;

function ensureBucket(env: SupabaseEnv): Promise<void> {
  bucketReady ??= fetch(`${env.url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ id: env.bucket, name: env.bucket, public: false }),
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (res) => {
      if (res.ok || res.status === 409) return;
      const text = await res.text();
      if (!/already exists|duplicate/i.test(text)) {
        throw new Error(`Supabase bucket setup failed (${res.status}): ${text}`);
      }
    })
    .catch((err) => {
      bucketReady = null;
      throw err;
    });
  return bucketReady;
}

async function supabasePut(env: SupabaseEnv, key: string, data: Uint8Array, contentType: string) {
  await ensureBucket(env);
  const res = await fetch(`${env.url}/storage/v1/object/${env.bucket}/${key}`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": contentType, "x-upsert": "false" },
    body: Buffer.from(data),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
}

async function supabaseSignedUrl(env: SupabaseEnv, key: string): Promise<string | null> {
  const res = await fetch(`${env.url}/storage/v1/object/sign/${env.bucket}/${key}`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const { signedURL } = (await res.json()) as { signedURL: string };
  return `${env.url}/storage/v1${signedURL}`;
}

export async function putFile(key: string, data: Uint8Array, contentType: string): Promise<void> {
  const env = supabaseEnv();
  if (env) {
    try {
      return await supabasePut(env, key, data, contentType);
    } catch (err) {
      console.error(`Supabase Storage unavailable, keeping ${key} in the database:`, (err as Error).message);
    }
  }
  await query("INSERT INTO files (key, content_type, data) VALUES ($1, $2, $3)", [
    key,
    contentType,
    Buffer.from(data),
  ]);
}

export async function fileResponse(key: string): Promise<Response> {
  const row = await queryOne<{ content_type: string; data: Uint8Array }>(
    "SELECT content_type, data FROM files WHERE key = $1",
    [key],
  );
  if (row) {
    return new Response(new Uint8Array(row.data), {
      headers: { "Content-Type": row.content_type, "Cache-Control": "private, max-age=31536000, immutable" },
    });
  }
  const env = supabaseEnv();
  const signed = env ? await supabaseSignedUrl(env, key) : null;
  if (!signed) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: signed, "Cache-Control": "private, max-age=300" } });
}

// Checks the first bytes so an upload labelled image/jpeg really is one.
export function sniffImage(data: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}
