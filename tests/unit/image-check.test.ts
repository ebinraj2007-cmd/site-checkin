import { describe, expect, it } from "vitest";
import { imageInfo } from "@/lib/image-check";

// A baseline JPEG's structure: SOI, APP0, a quantisation table, the frame header, the
// scan header, some image data and EOI.
function jpeg({ width = 320, height = 240, end = [0xff, 0xd9], data = 400 } = {}): Uint8Array {
  const segment = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return new Uint8Array([
    0xff, 0xd8,
    ...segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...segment(0xdb, [0, ...Array(64).fill(1)]),
    ...segment(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...segment(0xda, [1, 1, 0, 0, 63, 0]),
    ...Array(data).fill(0x55),
    ...end,
  ]);
}

// The 1×1 PNG a canvas makes, and its parts.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("imageInfo", () => {
  it("reads the type and size of a JPEG", () => {
    expect(imageInfo(jpeg())).toEqual({ type: "image/jpeg", width: 320, height: 240 });
    // A little padding after the end marker is fine.
    expect(imageInfo(jpeg({ end: [0xff, 0xd9, 0, 0, 0] }))?.type).toBe("image/jpeg");
  });

  it("reads the type and size of a PNG", () => {
    expect(imageInfo(new Uint8Array(PNG))).toEqual({ type: "image/png", width: 1, height: 1 });
  });

  it("refuses files that only start like an image", () => {
    expect(imageInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]))).toBeNull();
    expect(imageInfo(jpeg({ end: [0, 0] }))).toBeNull(); // cut off: no end marker
    expect(imageInfo(new Uint8Array(PNG.subarray(0, PNG.length - 12)))).toBeNull(); // no IEND
    expect(imageInfo(new TextEncoder().encode("<html>not an image</html>".repeat(20)))).toBeNull();
    expect(imageInfo(new Uint8Array(0))).toBeNull();
  });

  it("refuses sizes no camera makes", () => {
    expect(imageInfo(jpeg({ width: 0 }))).toBeNull();
    expect(imageInfo(jpeg({ width: 40000, height: 30000 }))).toBeNull();
  });
});
