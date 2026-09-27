"use client";

import { useSyncExternalStore } from "react";
import { ActionResult } from "@/components/ActionResult";
import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Field, inputClass } from "@/components/ui";
import { changeMyPin, saveSettingsAction } from "../actions";

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
        <Field label="Country code" htmlFor="countryCode" hint="Added to numbers typed without one.">
          <input id="countryCode" name="countryCode" inputMode="numeric" maxLength={4} defaultValue={values.countryCode} placeholder="971" className={inputClass} />
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
  return (
    <form onSubmit={onSubmit} key={state?.ok ? "done" : "form"} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Current PIN" htmlFor="current">
          <input id="current" name="current" type="password" inputMode="numeric" required autoComplete="current-password" className={inputClass} />
        </Field>
        <Field label="New PIN" htmlFor="new-pin">
          <input id="new-pin" name="pin" type="password" inputMode="numeric" pattern="\d{4,8}" required autoComplete="new-password" className={inputClass} />
        </Field>
        <Field label="Repeat new PIN" htmlFor="new-pin2">
          <input id="new-pin2" name="pin2" type="password" inputMode="numeric" pattern="\d{4,8}" required autoComplete="new-password" className={inputClass} />
        </Field>
      </div>
      <SubmitButton pending={pending} variant="secondary">Change PIN</SubmitButton>
      <ActionResult state={state} />
    </form>
  );
}
