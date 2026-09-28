// Structural checks for uploaded images. The app only ever sends JPEG photos (drawn on a
// canvas, at most 1600 px) and PNG signatures; a file must parse as one of those, with a
// sensible size and a proper end, before it is stored. No database or DOM here.

export type ImageInfo = { type: "image/jpeg" | "image/png"; width: number; height: number };

const MAX_SIDE = 8192;

export function imageInfo(data: Uint8Array): ImageInfo | null {
  const info = jpegInfo(data) ?? pngInfo(data);
  if (!info) return null;
  const { width, height } = info;
  return width >= 1 && height >= 1 && width <= MAX_SIDE && height <= MAX_SIDE ? info : null;
}

// JPEG: start-of-image, marker segments up to the frame header (which holds the size),
// and an end-of-image marker at the end (a little padding after it is tolerated).
function jpegInfo(d: Uint8Array): ImageInfo | null {
  if (d.length < 128 || d[0] !== 0xff || d[1] !== 0xd8) return null;
  if (!endsWith(d, [0xff, 0xd9], 32)) return null;
  let i = 2;
  while (i + 4 <= d.length) {
    if (d[i] !== 0xff) return null;
    const marker = d[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Markers without a length (another SOI, EOI, restarts) or the image data itself
    // can't come before the frame header.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0xda) return null;
    const length = (d[i + 2] << 8) | d[i + 3];
    if (length < 2) return null;
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (length < 8 || i + 9 > d.length) return null;
      return { type: "image/jpeg", height: (d[i + 5] << 8) | d[i + 6], width: (d[i + 7] << 8) | d[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

// PNG: signature, the IHDR chunk first (width and height), the IEND chunk last.
function pngInfo(d: Uint8Array): ImageInfo | null {
  if (d.length < PNG_SIGNATURE.length + 25 + PNG_IEND.length) return null;
  if (!PNG_SIGNATURE.every((b, i) => d[i] === b)) return null;
  if (u32(d, 8) !== 13 || String.fromCharCode(d[12], d[13], d[14], d[15]) !== "IHDR") return null;
  if (!endsWith(d, PNG_IEND, 0)) return null;
  return { type: "image/png", width: u32(d, 16), height: u32(d, 20) };
}

function u32(d: Uint8Array, i: number): number {
  return d[i] * 2 ** 24 + (d[i + 1] << 16) + (d[i + 2] << 8) + d[i + 3];
}

// True if `tail` ends somewhere in the last `slack` bytes (0: exactly at the end).
function endsWith(d: Uint8Array, tail: number[], slack: number): boolean {
  for (let end = d.length; end >= Math.max(tail.length, d.length - slack); end--) {
    if (tail.every((b, k) => d[end - tail.length + k] === b)) return true;
  }
  return false;
}
