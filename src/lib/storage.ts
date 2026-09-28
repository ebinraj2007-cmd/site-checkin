import "server-only";
import { query, queryOne } from "./db";
import { env } from "./env";

// Photos and signatures. Two places they can live:
//  - Supabase Storage (private bucket) when SUPABASE_URL + a service key are set.
//  - The `files` table in the app's own database: nothing else to set up, fine for a
//    small team, but it grows the database (~0.3 MB per photo).
// If Supabase can't be reached, the file goes to the database instead, so a storage
// hiccup never loses a check-in. If Supabase refuses the file (full, too large), it is
// refused, not moved: files may only ever fill DB_FILES_LIMIT_MB of the database, so they
// can't push it over its plan's size, which would make the whole app read-only.
// Reads look in the database first, then Supabase.

// A file that couldn't be stored; the message is for the person uploading it.
export class StorageError extends Error {}

const DB_FILES_LIMIT_MB = Number(process.env.DB_FILES_LIMIT_MB) || 300;

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

// Throws StorageError when Supabase answered and refused the file; any other error means
// it couldn't be reached (or is failing, or its key is wrong) and the database may step in.
async function supabasePut(env: SupabaseEnv, key: string, data: Uint8Array, contentType: string) {
  await ensureBucket(env);
  const res = await fetch(`${env.url}/storage/v1/object/${env.bucket}/${key}`, {
    method: "POST",
    headers: { ...supabaseHeaders(env), "Content-Type": contentType, "x-upsert": "false" },
    body: Buffer.from(data),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.ok) return;
  const detail = `Supabase upload failed (${res.status}): ${await res.text()}`;
  if (res.status >= 500 || res.status === 401 || res.status === 403) throw new Error(detail);
  console.error(detail);
  throw new StorageError("The photo store refused this file. It may be full: tell your manager.");
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

// Stores a file or throws StorageError.
export async function putFile(key: string, data: Uint8Array, contentType: string): Promise<void> {
  const env = supabaseEnv();
  if (env) {
    try {
      return await supabasePut(env, key, data, contentType);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      console.error(`Supabase Storage unavailable, keeping ${key} in the database:`, (err as Error).message);
    }
  }
  const used = await queryOne<{ bytes: number }>("SELECT pg_total_relation_size('files')::float8 AS bytes");
  if ((used?.bytes ?? 0) + data.byteLength > DB_FILES_LIMIT_MB * 1024 * 1024) {
    console.error(`Files in the database reached DB_FILES_LIMIT_MB (${DB_FILES_LIMIT_MB} MB); refusing ${key}.`);
    throw new StorageError("Photo storage is full. Tell your manager.");
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
