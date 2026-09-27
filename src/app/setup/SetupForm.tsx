"use client";

import { useSyncExternalStore } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Alert, Card, Field, inputClass } from "@/components/ui";
import { setupAction } from "./actions";

const detectTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function SetupForm() {
  const [state, onSubmit, pending] = useFormAction(setupAction, null);
  // The browser's timezone becomes the company timezone (changeable in Settings).
  const timezone = useSyncExternalStore(
    () => () => {},
    detectTimezone,
    () => "UTC",
  );
  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Company name" htmlFor="company">
          <input id="company" name="company" required maxLength={80} className={inputClass} placeholder="e.g. Cool Air Services" />
        </Field>
        <Field label="Your name" htmlFor="name">
          <input id="name" name="name" required maxLength={80} autoComplete="name" className={inputClass} />
        </Field>
        <div className="grid grid-cols-[6.5rem_1fr] gap-3">
          <Field label="Country code" htmlFor="countryCode">
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-500">+</span>
              <input
                id="countryCode"
                name="countryCode"
                inputMode="numeric"
                maxLength={4}
                placeholder="971"
                className={`${inputClass} pl-6`}
              />
            </div>
          </Field>
          <Field label="Your mobile number" htmlFor="phone">
            <input id="phone" name="phone" type="tel" required autoComplete="tel" className={inputClass} placeholder="050 123 4567" />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-slate-500">
          The country code is used for workers&apos; numbers typed without one, and for WhatsApp links.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Choose a PIN" htmlFor="pin" hint="4–8 digits">
            <input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{4,8}" required autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="Repeat PIN" htmlFor="pin2">
            <input id="pin2" name="pin2" type="password" inputMode="numeric" pattern="\d{4,8}" required autoComplete="new-password" className={inputClass} />
          </Field>
        </div>
        <input type="hidden" name="timezone" value={timezone} />
        <p className="text-xs text-slate-500">
          Timezone: <span className="font-medium text-slate-700">{timezone}</span> (from this device)
        </p>
        {state?.error && <Alert tone="red">{state.error}</Alert>}
        <SubmitButton pending={pending} size="lg" pendingText="Setting up…">
          Create my account
        </SubmitButton>
      </form>
    </Card>
  );
}
