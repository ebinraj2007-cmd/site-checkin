"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Alert, Card, Field, inputClass } from "@/components/ui";
import { recoverAction } from "./actions";

export function RecoverForm() {
  const [state, onSubmit, pending] = useFormAction(recoverAction, null);
  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Setup code" htmlFor="setupCode" hint="The SETUP_CODE set where this app is hosted.">
          <input id="setupCode" name="setupCode" required autoComplete="off" className={inputClass} />
        </Field>
        <Field label="Manager's mobile number" htmlFor="phone">
          <input id="phone" name="phone" type="tel" required autoComplete="tel" className={inputClass} placeholder="050 123 4567" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New PIN" htmlFor="pin" hint="6–8 digits">
            <input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{6,8}" required autoComplete="new-password" className={inputClass} />
          </Field>
          <Field label="Repeat new PIN" htmlFor="pin2">
            <input id="pin2" name="pin2" type="password" inputMode="numeric" pattern="\d{6,8}" required autoComplete="new-password" className={inputClass} />
          </Field>
        </div>
        {state?.error && <Alert tone="red">{state.error}</Alert>}
        <SubmitButton pending={pending} size="lg" pendingText="Resetting…">
          Reset PIN and log in
        </SubmitButton>
      </form>
    </Card>
  );
}
