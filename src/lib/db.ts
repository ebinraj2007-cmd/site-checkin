import "server-only";
import { env } from "./env";
import { MIGRATIONS } from "./migrations";

// One small interface over two drivers:
//  - Postgres (DATABASE_URL / POSTGRES_URL) in production, e.g. Supabase or Neon.
//  - PGlite, an embedded Postgres in .data/pglite, when no URL is set (local dev and tests).
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  kind: "postgres" | "pglite";
  tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
}

const globalForDb = globalThis as unknown as { __siteCheckinDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!globalForDb.__siteCheckinDb) {
    globalForDb.__siteCheckinDb = connect().catch((err) => {
      globalForDb.__siteCheckinDb = undefined;
      throw err;
    });
  }
  return globalForDb.__siteCheckinDb;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await getDb()).query<T>(text, params);
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<R>(fn: (q: Queryable) => Promise<R>): Promise<R> {
  return (await getDb()).tx(fn);
}

export function databaseUrl(): string {
  return env("DATABASE_URL") || env("POSTGRES_URL") || "";
}

async function connect(): Promise<Db> {
  const url = databaseUrl();
  const db = url ? await connectPostgres(url) : await connectPglite();
  await migrate(db);
  return db;
}

// Hosted Postgres URLs often carry extra query parameters (sslmode, channel_binding,
// supa=...) that node-postgres either misreads or forwards to the server. Strip them
// and set TLS explicitly: encrypted, without CA pinning (libpq's sslmode=require).
export function postgresConfig(url: string) {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get("sslmode");
  parsed.search = "";
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const ssl = sslmode === "disable" || (local && sslmode !== "require")
    ? false
    : { rejectUnauthorized: false };
  return { connectionString: parsed.toString(), ssl };
}

async function connectPostgres(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  const pool = new Pool({
    ...postgresConfig(url),
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  return {
    kind: "postgres",
    async query(text, params = []) {
      return (await pool.query(text, params)).rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          async query(text, params = []) {
            return (await client.query(text, params)).rows;
          },
          async exec(sql) {
            await client.query(sql);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

async function connectPglite(): Promise<Db> {
  if (process.env.VERCEL) {
    throw new Error(
      "No database is connected. In Vercel, open the project → Storage → add Supabase " +
        "(or Neon), connect it to this project, then redeploy.",
    );
  }
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const dir = process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite");
  await fs.mkdir(dir, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(dir);
  await pg.waitReady;
  return {
    kind: "pglite",
    async query(text, params = []) {
      return (await pg.query(text, params)).rows as never[];
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    tx(fn) {
      return pg.transaction((t) =>
        fn({
          async query(text, params = []) {
            return (await t.query(text, params)).rows as never[];
          },
          async exec(sql) {
            await t.exec(sql);
          },
        }),
      );
    },
  };
}

async function migrate(db: Db) {
  await db.tx(async (q) => {
    // Serverless instances can start together; only one applies migrations.
    if (db.kind === "postgres") await q.query("SELECT pg_advisory_xact_lock(4101977)");
    await q.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = new Set(
      (await q.query<{ id: number }>("SELECT id FROM schema_migrations")).map((r) => r.id),
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      await q.exec(m.sql);
      await q.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
    }
  });
}
