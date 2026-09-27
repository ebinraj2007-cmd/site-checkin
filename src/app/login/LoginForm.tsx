"use client";

import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Alert, Card, Field, inputClass } from "@/components/ui";
import { loginAction } from "./actions";

export function LoginForm() {
  const [state, onSubmit, pending] = useFormAction(loginAction, null);
  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Phone number" htmlFor="phone">
          <input id="phone" name="phone" type="tel" required autoComplete="tel" className={inputClass} placeholder="050 123 4567" />
        </Field>
        <Field label="PIN" htmlFor="pin">
          <input
            id="pin"
            name="pin"
            type="password"
            inputMode="numeric"
            required
            autoComplete="current-password"
            className={`${inputClass} tracking-[0.3em]`}
          />
        </Field>
        {state?.error && <Alert tone="red">{state.error}</Alert>}
        <SubmitButton pending={pending} size="lg" pendingText="Logging in…">
          Log in
        </SubmitButton>
      </form>
    </Card>
  );
}
