"use client";

import { ActionResult } from "@/components/ActionResult";
import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Field, inputClass } from "@/components/ui";
import { createWorker } from "../actions";

export function AddWorkerForm() {
  const [state, onSubmit, pending] = useFormAction(createWorker, null);
  return (
    <form onSubmit={onSubmit} key={state?.ok ? state.message : "form"} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <input id="name" name="name" required maxLength={80} className={inputClass} />
        </Field>
        <Field label="Mobile number" htmlFor="phone" hint="Their login. Also used for WhatsApp.">
          <input id="phone" name="phone" type="tel" required className={inputClass} placeholder="050 123 4567" />
        </Field>
        <Field label="PIN" htmlFor="pin" hint="Leave empty to make one up.">
          <input id="pin" name="pin" inputMode="numeric" pattern="\d{6,8}" maxLength={8} className={inputClass} />
        </Field>
        <Field label="Role" htmlFor="role">
          <select id="role" name="role" defaultValue="worker" className={inputClass}>
            <option value="worker">Worker (gets jobs)</option>
            <option value="manager">Manager (can create jobs)</option>
          </select>
        </Field>
      </div>
      <SubmitButton pending={pending} pendingText="Adding…">Add worker</SubmitButton>
      <ActionResult state={state} whatsappLabel="Send login on WhatsApp" />
    </form>
  );
}
