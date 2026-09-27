import { describe, expect, it } from "vitest";
import { dateToLocalInput, dayRange, formatDay, formatDuration, localInputToDate } from "@/lib/time";

describe("timezone conversion", () => {
  it("Dubai (UTC+4, no DST)", () => {
    expect(localInputToDate("2026-09-27T10:00", "Asia/Dubai")?.toISOString()).toBe("2026-09-27T06:00:00.000Z");
    expect(dateToLocalInput(new Date("2026-09-27T06:00:00Z"), "Asia/Dubai")).toBe("2026-09-27T10:00");
  });
  it("India (UTC+5:30)", () => {
    expect(localInputToDate("2026-01-05T09:15", "Asia/Kolkata")?.toISOString()).toBe("2026-01-05T03:45:00.000Z");
  });
  it("London across the DST change", () => {
    expect(localInputToDate("2026-03-28T12:00", "Europe/London")?.toISOString()).toBe("2026-03-28T12:00:00.000Z");
    expect(localInputToDate("2026-03-30T12:00", "Europe/London")?.toISOString()).toBe("2026-03-30T11:00:00.000Z");
  });
  it("round-trips", () => {
    for (const tz of ["America/New_York", "Asia/Dubai", "Australia/Sydney", "UTC"]) {
      const d = localInputToDate("2026-07-14T18:45", tz)!;
      expect(dateToLocalInput(d, tz)).toBe("2026-07-14T18:45");
    }
  });
  it("rejects bad input", () => {
    expect(localInputToDate("tomorrow", "UTC")).toBeNull();
  });
});

describe("dayRange", () => {
  it("covers the local calendar day", () => {
    const [start, end] = dayRange("Asia/Dubai", new Date("2026-09-27T22:30:00Z")); // 02:30 on the 28th in Dubai
    expect(start.toISOString()).toBe("2026-09-27T20:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-28T20:00:00.000Z");
  });
});

describe("formatting", () => {
  const now = new Date("2026-09-27T08:00:00Z");
  it("names nearby days", () => {
    expect(formatDay(new Date("2026-09-27T12:00:00Z"), "Asia/Dubai", now)).toBe("Today");
    expect(formatDay(new Date("2026-09-28T12:00:00Z"), "Asia/Dubai", now)).toBe("Tomorrow");
    expect(formatDay(new Date("2026-09-26T12:00:00Z"), "Asia/Dubai", now)).toBe("Yesterday");
    expect(formatDay(new Date("2026-10-02T12:00:00Z"), "Asia/Dubai", now)).toBe("Fri 2 Oct");
  });
  it("formats durations", () => {
    expect(formatDuration(30_000)).toBe("30 s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(85 * 60_000)).toBe("1 h 25 min");
    expect(formatDuration(120 * 60_000)).toBe("2 h");
  });
});
