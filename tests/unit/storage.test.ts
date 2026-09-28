import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));

const { query, queryOne } = await import("@/lib/db");
const { putFile, StorageError } = await import("@/lib/storage");

const bytes = new Uint8Array(1000);
const inserts = () => vi.mocked(query).mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO files"));

describe("putFile", () => {
  beforeEach(() => {
    vi.mocked(query).mockReset().mockResolvedValue([]);
    vi.mocked(queryOne).mockReset().mockResolvedValue({ bytes: 10 * 1024 * 1024 });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function supabase(upload: () => Promise<Response>) {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJtest");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/storage/v1/bucket") ? new Response("{}", { status: 200 }) : upload(),
      ),
    );
  }

  it("stores in Supabase when it accepts the file", async () => {
    supabase(async () => new Response("{}", { status: 200 }));
    await putFile("photos/a.jpg", bytes, "image/jpeg");
    expect(inserts()).toHaveLength(0);
  });

  it("falls back to the database when Supabase is down or unreachable", async () => {
    supabase(async () => new Response("oops", { status: 503 }));
    await putFile("photos/b.jpg", bytes, "image/jpeg");
    supabase(async () => {
      throw new TypeError("fetch failed");
    });
    await putFile("photos/c.jpg", bytes, "image/jpeg");
    expect(inserts()).toHaveLength(2);
  });

  it("refuses, rather than moves to the database, a file Supabase turned down", async () => {
    supabase(async () => new Response('{"error":"Payload too large"}', { status: 413 }));
    await expect(putFile("photos/d.jpg", bytes, "image/jpeg")).rejects.toBeInstanceOf(StorageError);
    expect(inserts()).toHaveLength(0);
  });

  it("stops filling the database at DB_FILES_LIMIT_MB", async () => {
    vi.mocked(queryOne).mockResolvedValue({ bytes: 300 * 1024 * 1024 });
    await expect(putFile("photos/e.jpg", bytes, "image/jpeg")).rejects.toThrow("Photo storage is full");
    expect(inserts()).toHaveLength(0);
  });
});
