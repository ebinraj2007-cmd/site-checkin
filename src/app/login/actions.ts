"use server";

import { redirect } from "next/navigation";
import { checkLogin, startSession } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";

export type LoginState = { error?: string } | null;

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const { countryCode } = await getSettings();
  const phone = normalizePhone(String(form.get("phone") ?? ""), countryCode);
  const pin = String(form.get("pin") ?? "");
  if (!phone || !pin) return { error: "Enter your phone number and PIN." };
  const result = await checkLogin(phone, pin);
  if (!result.ok) return { error: result.error };
  await startSession(result.user.id);
  redirect(result.user.role === "manager" ? "/m" : "/w");
}
