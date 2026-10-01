"use server";

import { redirect } from "next/navigation";
import { endAllSessions, forgetDevices, hashPin, isValidPin, startSession, trustDevice } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { removePasskeys } from "@/lib/passkeys";
import { normalizePhone } from "@/lib/phone";
import { deleteAllSubscriptions } from "@/lib/push";
import { getSettings } from "@/lib/settings";
import { recoveryEnabled, setupCodeMatches } from "@/lib/setup-code";

export type RecoverState = { error?: string } | null;

// A manager who forgot their PIN, is locked out, or lost their phone sets a new PIN with
// the SETUP_CODE. Every other login, alert and passkey of theirs is cut off.
export async function recoverAction(_prev: RecoverState, form: FormData): Promise<RecoverState> {
  if (!recoveryEnabled()) return { error: "Recovery is turned off for this app." };
  if (!setupCodeMatches(String(form.get("setupCode") ?? ""))) return { error: "That setup code is wrong." };
  const { countryCode } = await getSettings();
  const phone = normalizePhone(String(form.get("phone") ?? ""), countryCode);
  const pin = String(form.get("pin") ?? "");
  const pin2 = String(form.get("pin2") ?? "");
  if (!phone) return { error: "Enter the manager's mobile number." };
  if (!isValidPin(pin)) return { error: "The PIN must be 6 to 8 digits." };
  if (pin !== pin2) return { error: "The two PINs don't match." };
  const user = await queryOne<{ id: string }>(
    `UPDATE users SET pin_hash = $2, failed_logins = 0, locked_until = NULL
      WHERE phone = $1 AND role = 'manager' AND active RETURNING id`,
    [phone, await hashPin(pin)],
  );
  if (!user) return { error: "No manager has that mobile number." };
  await endAllSessions(user.id);
  await deleteAllSubscriptions(user.id);
  await forgetDevices(user.id);
  await removePasskeys(user.id); // a lost phone's fingerprint login stops working too
  await startSession(user.id);
  await trustDevice(user.id);
  redirect("/m");
}
