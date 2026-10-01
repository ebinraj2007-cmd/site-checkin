import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { imagePrint, printDistance, sha256Hex } = await import("@/lib/photo-hash");

// A busy picture (like a real scene) with a camera-style stamp along the bottom.
async function photo(seed: number, { stamp = "A", shiftX = 0, quality = 82, brighten = 1 } = {}) {
  const width = 800;
  const height = 600;
  let n = seed;
  const random = () => ((n = (n * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const shapes = Array.from({ length: 60 }, () => {
    const [x, y, w, h] = [random() * width, random() * height, 20 + random() * 200, 20 + random() * 200];
    const fill = `rgb(${Math.round(random() * 255)},${Math.round(random() * 255)},${Math.round(random() * 255)})`;
    return `<rect x="${x + shiftX}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#89a"/>${shapes}
    <rect x="0" y="${height - 120}" width="${width}" height="120" fill="rgba(0,0,0,0.6)"/>
    <text x="20" y="${height - 60}" font-size="30" fill="#fff">${stamp}</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).linear(brighten, 0).jpeg({ quality }).toBuffer());
}

describe("imagePrint", () => {
  it("matches a photo sent again re-saved, re-stamped or brightened", async () => {
    const original = (await imagePrint(await photo(1)))!;
    expect(original.hash).toMatch(/^[01]{256}$/);
    expect(original.blank).toBe(false);
    for (const copy of [await photo(1, { quality: 50 }), await photo(1, { stamp: "B 27 Sep 10:04" }), await photo(1, { brighten: 1.15 })]) {
      expect(printDistance(original.hash, (await imagePrint(copy))!.hash)).toBeLessThanOrEqual(12);
    }
  });
  it("tells different photos apart", async () => {
    const a = (await imagePrint(await photo(1)))!;
    const b = (await imagePrint(await photo(2)))!;
    expect(printDistance(a.hash, b.hash)).toBeGreaterThan(60);
  });
  it("spots a blank picture (covered lens, dark room)", async () => {
    const black = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#080808" } }).jpeg().toBuffer();
    expect((await imagePrint(new Uint8Array(black)))!.blank).toBe(true);
  });
  it("gives up quietly on a file it can't read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await imagePrint(Uint8Array.from([0xff, 0xd8, 1, 2, 3]))).toBeNull();
    warn.mockRestore();
  });
});

describe("sha256Hex", () => {
  it("fingerprints the exact bytes", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
