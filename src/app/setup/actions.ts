"use server";

import { redirect } from "next/navigation";
import { hashPin, isValidPin, startSession } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { validTimezone } from "@/lib/settings";

export type SetupState = { error?: string } | null;

export async function setupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  const company = String(form.get("company") ?? "").trim().slice(0, 80);
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const countryCode = String(form.get("countryCode") ?? "").replace(/\D/g, "").slice(0, 4);
  const pin = String(form.get("pin") ?? "");
  const pin2 = String(form.get("pin2") ?? "");
  const timezone = validTimezone(String(form.get("timezone") ?? "")) ?? "UTC";
  const phone = normalizePhone(String(form.get("phone") ?? ""), countryCode);

  if (!company || !name) return { error: "Enter your company name and your name." };
  if (!countryCode) return { error: "Enter your country code, e.g. 971 for the UAE or 91 for India." };
  if (!phone) return { error: "That mobile number doesn't look right. Check the country code and the number." };
  if (!isValidPin(pin)) return { error: "The PIN must be 6 to 8 digits." };
  if (pin !== pin2) return { error: "The two PINs don't match." };

  const pinHash = await hashPin(pin);
  const userId = await transaction(async (q) => {
    await q.exec("LOCK TABLE users IN EXCLUSIVE MODE");
    if ((await q.query("SELECT 1 FROM users LIMIT 1")).length) return null;
    const settings: [string, string][] = [
      ["company_name", company],
      ["country_code", countryCode],
      ["timezone", timezone],
    ];
    for (const [key, value] of settings) {
      await q.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [key, value],
      );
    }
    const [row] = await q.query<{ id: string }>(
      "INSERT INTO users (name, phone, role, pin_hash) VALUES ($1, $2, 'manager', $3) RETURNING id",
      [name, phone, pinHash],
    );
    return row.id;
  });
  if (!userId) redirect("/login"); // someone finished setup first
  await startSession(userId);
  redirect("/m");
}
