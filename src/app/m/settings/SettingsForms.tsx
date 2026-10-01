"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ActionResult } from "@/components/ActionResult";
import { resaveSubscription } from "@/components/PushSetup";
import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Field, inputClass } from "@/components/ui";
import { changeMyPin, saveSecurity, saveSettingsAction } from "../actions";

type Values = { companyName: string; countryCode: string; timezone: string; defaultRadius: number };

const noSubscribe = () => () => {};
const browserZones = () => Intl.supportedValuesOf("timeZone").join("|");

export function SettingsForm({ values }: { values: Values }) {
  const [state, onSubmit, pending] = useFormAction(saveSettingsAction, null);
  const zonesKey = useSyncExternalStore(noSubscribe, browserZones, () => "");
  const zones = zonesKey ? zonesKey.split("|") : [];
  if (!zones.includes(values.timezone)) zones.unshift(values.timezone);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Company name" htmlFor="companyName">
        <input id="companyName" name="companyName" required maxLength={80} defaultValue={values.companyName} className={inputClass} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Country code" htmlFor="countryCode" hint="Used for numbers typed without one.">
          <input id="countryCode" name="countryCode" required inputMode="numeric" maxLength={4} defaultValue={values.countryCode} placeholder="971" className={inputClass} />
        </Field>
        <Field label="Timezone" htmlFor="timezone">
          <select id="timezone" name="timezone" defaultValue={values.timezone} key={zones.length} className={inputClass}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default check-in distance (m)" htmlFor="defaultRadius">
          <input id="defaultRadius" name="defaultRadius" type="number" min={20} max={5000} step={10} defaultValue={values.defaultRadius} className={inputClass} />
        </Field>
      </div>
      <SubmitButton pending={pending}>Save settings</SubmitButton>
      <ActionResult state={state} />
    </form>
  );
}

export function ChangePinForm() {
  const [state, onSubmit, pending] = useFormAction(changeMyPin, null);
  // The change turned alerts off everywhere; this device keeps them.
  useEffect(() => {
    if (state?.ok) resaveSubscription().catch(() => {});
  }, [state]);
  return (
    <form onSubmit={onSubmit} key={state?.ok ? "done" : "form"} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current PIN" htmlFor="current">
          <input id="current" name="current" type="password" inputMode="numeric" required autoComplete="current-password" className={inputClass} />
        </Field>
        <Field label="New PIN" htmlFor="new-pin">
          <input id="new-pin" name="pin" type="password" inputMode="numeric" pattern="\d{6,8}" required autoComplete="new-password" className={inputClass} />
        </Field>
        <Field label="Repeat new PIN" htmlFor="new-pin2">
          <input id="new-pin2" name="pin2" type="password" inputMode="numeric" pattern="\d{6,8}" required autoComplete="new-password" className={inputClass} />
        </Field>
      </div>
      <SubmitButton pending={pending} variant="secondary">Change PIN</SubmitButton>
      <ActionResult state={state} />
    </form>
  );
}

export function SecurityForm({ requirePasskeys }: { requirePasskeys: boolean }) {
  const [state, onSubmit, pending] = useFormAction(saveSecurity, null);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
        <input
          type="checkbox"
          name="require_passkeys"
          defaultChecked={requirePasskeys}
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
        />
        <span>
          <span className="block text-sm font-semibold text-slate-800">Workers must log in with fingerprint or face</span>
          <span className="block text-xs text-slate-500">
            Stops PINs being shared so someone else checks in. Workers are asked to set it up on their phone; once they have,
            their PIN no longer works. If a phone is lost, reset that worker&apos;s PIN.
          </span>
        </span>
      </label>
      <SubmitButton pending={pending} variant="secondary">
        Save
      </SubmitButton>
      <ActionResult state={state} />
    </form>
  );
}
