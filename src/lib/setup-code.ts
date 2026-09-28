import "server-only";
import { timingSafeEqual } from "node:crypto";

// SETUP_CODE guards first-time setup and, later, manager recovery. Surrounding spaces or
// a trailing newline in the variable are ignored, and so is letter case when typing it.
export function setupCode(): string {
  return (process.env.SETUP_CODE ?? "").trim();
}

export function setupCodeMatches(given: string): boolean {
  const expected = Buffer.from(setupCode().toUpperCase());
  const actual = Buffer.from(given.trim().toUpperCase());
  return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Recovery stays available for the life of the app, so it needs a code nobody can guess.
export const RECOVERY_MIN_LENGTH = 12;

export function recoveryEnabled(): boolean {
  return setupCode().length >= RECOVERY_MIN_LENGTH;
}
