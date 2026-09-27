// Dates are stored in UTC and shown in the company's timezone (Settings → timezone),
// so the server renders the same times the manager and workers see on their phones.

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsInTz(date: Date, tz: string): Parts {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(date)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

function offsetMs(date: Date, tz: string): number {
  const p = partsInTz(date, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(date.getTime() / 1000) * 1000;
}

// Wall-clock time in `tz` → instant. Day/month overflow is fine (Date.UTC normalises it).
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(new Date(guess), tz);
  let result = guess - first;
  const second = offsetMs(new Date(result), tz);
  if (second !== first) result = guess - second; // crossed a DST change
  return new Date(result);
}

const pad = (n: number) => String(n).padStart(2, "0");

// <input type="datetime-local"> value ("2026-09-27T10:00") in `tz` → instant.
export function localInputToDate(value: string, tz: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz);
}

export function dateToLocalInput(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function dayKey(date: Date, tz: string): string {
  const p = partsInTz(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// [start, end) of a calendar day in `tz`, `offsetDays` from the day containing `now`.
export function dayRange(tz: string, now = new Date(), offsetDays = 0): [Date, Date] {
  const p = partsInTz(now, tz);
  return [
    zonedToUtc(p.year, p.month, p.day + offsetDays, 0, 0, tz),
    zonedToUtc(p.year, p.month, p.day + offsetDays + 1, 0, 0, tz),
  ];
}

// "YYYY-MM-DD" in `tz` → [start, end) of that day.
export function dateKeyRange(key: string, tz: string): [Date, Date] | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return [zonedToUtc(+m[1], +m[2], +m[3], 0, 0, tz), zonedToUtc(+m[1], +m[2], +m[3] + 1, 0, 0, tz)];
}

export function formatTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(
    date,
  );
}

export function formatDay(date: Date, tz: string, now = new Date()): string {
  const key = dayKey(date, tz);
  if (key === dayKey(now, tz)) return "Today";
  if (key === dayKey(new Date(now.getTime() + 86_400_000), tz)) return "Tomorrow";
  if (key === dayKey(new Date(now.getTime() - 86_400_000), tz)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function formatDateTime(date: Date, tz: string, now = new Date()): string {
  return `${formatDay(date, tz, now)}, ${formatTime(date, tz)}`;
}

// Unambiguous form for photo stamps and exports: "27 Sep 2026, 10:04:12 AM".
export function formatStamp(date: Date, tz: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
  return `${day}, ${time}`;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatLongDate(date: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(date);
}

// For text read later (WhatsApp messages, notifications): "Sun 27 Sep, 10:00 AM", never "Today".
export function formatWhen(date: Date, tz: string): string {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(date);
  return `${day}, ${formatTime(date, tz)}`;
}
