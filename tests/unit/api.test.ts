import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));

const { readBody } = await import("@/lib/api");

// A body sent in chunks, without a Content-Length (as a chunked upload arrives).
function chunked(chunks: number, size: number, type = "application/json") {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < chunks; i++) controller.enqueue(new Uint8Array(size).fill(0x20));
      controller.enqueue(new TextEncoder().encode('{"ok":true}'));
      controller.close();
    },
  });
  return new Request("http://localhost/api/x", {
    method: "POST",
    body: stream,
    headers: { "Content-Type": type },
    duplex: "half",
  } as RequestInit);
}

describe("readBody", () => {
  it("reads a body within the limit", async () => {
    const body = await readBody(chunked(3, 1000), 10_000);
    expect(await body!.json()).toEqual({ ok: true });
  });

  it("stops reading a chunked body once it passes the limit", async () => {
    expect(await readBody(chunked(50, 1000), 10_000)).toBeNull();
  });

  it("refuses by Content-Length before reading", async () => {
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      body: "x".repeat(20),
      headers: { "Content-Length": "999999" },
    });
    expect(await readBody(req, 10_000)).toBeNull();
  });

  it("keeps multipart forms readable", async () => {
    const form = new FormData();
    form.set("kind", "work");
    form.set("photo", new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }), "photo.jpg");
    const body = await readBody(new Request("http://localhost/api/x", { method: "POST", body: form }), 10_000);
    const parsed = await body!.formData();
    expect(parsed.get("kind")).toBe("work");
    expect((parsed.get("photo") as File).size).toBe(3);
  });
});
