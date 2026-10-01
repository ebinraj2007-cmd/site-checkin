import "server-only";
import { createHash } from "node:crypto";

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export type ImagePrint = {
  hash: string; // 256 bits as "0101…", for Postgres bit(256)
  blank: boolean; // too dark, too bright or too plain to show anything
};

const COLS = 17;
const ROWS = 16;
// The camera stamps time, place and job along the bottom, different on every photo; the
// look-alike check only looks above it (the stamp takes at most about a third).
const TOP_SHARE = 0.6;
// Grey levels (0–255) vary less than this across a blank picture.
const BLANK_SPREAD = 3;

let warned = false;

// A look-alike fingerprint (a "difference hash"): the picture above the stamp shrunk to
// 17×16 grey cells, one bit per pair of neighbours (is the right one brighter?). A photo
// sent again, re-saved, re-stamped or lightly edited stays within a few bits of the
// original; a new photo, even of the same place, differs in dozens. Null when the image
// can't be read here (the image library is missing on this server).
export async function imagePrint(data: Uint8Array): Promise<ImagePrint | null> {
  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(data).metadata();
    if (!meta.width || !meta.height) return null;
    const { data: px, info } = await sharp(data)
      .extract({ left: 0, top: 0, width: meta.width, height: Math.max(1, Math.floor(meta.height * TOP_SHARE)) })
      .resize(COLS, ROWS, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const grey = (row: number, col: number) => px[(row * COLS + col) * info.channels];
    let bits = "";
    let sum = 0;
    let squares = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const g = grey(row, col);
        sum += g;
        squares += g * g;
        if (col > 0) bits += g > grey(row, col - 1) ? "1" : "0";
      }
    }
    const n = ROWS * COLS;
    const spread = Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2));
    return { hash: bits, blank: spread < BLANK_SPREAD };
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn("Look-alike photo check unavailable:", (err as Error).message);
    }
    return null;
  }
}

// Bits that differ between two fingerprints.
export function printDistance(a: string, b: string): number {
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}
