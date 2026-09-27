import "server-only";
import { cache } from "react";
import { query } from "./db";

export type Settings = {
  companyName: string;
  countryCode: string; // calling code without "+", e.g. "971"
  timezone: string; // IANA name, e.g. "Asia/Dubai"
  defaultRadius: number; // metres
};

const DEFAULTS: Settings = {
  companyName: "Site Check-in",
  countryCode: "",
  timezone: "UTC",
  defaultRadius: 150,
};

const KEYS: Record<keyof Settings, string> = {
  companyName: "company_name",
  countryCode: "country_code",
  timezone: "timezone",
  defaultRadius: "default_radius",
};

export const getSettings = cache(async (): Promise<Settings> => {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const radius = Number(map.get(KEYS.defaultRadius));
  return {
    companyName: map.get(KEYS.companyName) || DEFAULTS.companyName,
    countryCode: map.get(KEYS.countryCode) ?? DEFAULTS.countryCode,
    timezone: validTimezone(map.get(KEYS.timezone)) ?? DEFAULTS.timezone,
    defaultRadius: Number.isFinite(radius) && radius > 0 ? radius : DEFAULTS.defaultRadius,
  };
});

export async function saveSettings(values: Partial<Settings>) {
  for (const [field, value] of Object.entries(values)) {
    if (value === undefined) continue;
    await setSetting(KEYS[field as keyof Settings], String(value));
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>("SELECT value FROM settings WHERE key = $1", [key]);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export function validTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
