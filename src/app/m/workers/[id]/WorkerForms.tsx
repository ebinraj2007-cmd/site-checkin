"use client";

import { ActionResult } from "@/components/ActionResult";
import { SubmitButton } from "@/components/SubmitButton";
import { useFormAction } from "@/components/useFormAction";
import { Field, inputClass } from "@/components/ui";
import { resetPin, updateWorker } from "../../actions";

type Worker = { id: string; name: string; phone: string; role: string; active: boolean };

export function EditWorkerForm({ worker, isMe }: { worker: Worker; isMe: boolean }) {
  const [state, onSubmit, pending] = useFormAction(updateWorker.bind(null, worker.id), null);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <input id="name" name="name" required maxLength={80} defaultValue={worker.name} className={inputClass} />
        </Field>
        <Field label="Mobile number" htmlFor="phone">
          <input id="phone" name="phone" type="tel" required defaultValue={`+${worker.phone}`} className={inputClass} />
        </Field>
        <Field label="Role" htmlFor="role">
          <select id="role" name="role" defaultValue={worker.role} disabled={isMe} className={inputClass}>
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </select>
          {isMe && <input type="hidden" name="role" value="manager" />}
        </Field>
        <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 p-3">
          <input type="checkbox" name="active" defaultChecked={worker.active} disabled={isMe} className="h-5 w-5 accent-brand-700" />
          {isMe && <input type="hidden" name="active" value="on" />}
          <span className="text-sm font-semibold">Can log in</span>
        </label>
      </div>
      <SubmitButton pending={pending}>Save</SubmitButton>
      <ActionResult state={state} />
    </form>
  );
}

export function ResetPinForm({ workerId }: { workerId: string }) {
  const [state, onSubmit, pending] = useFormAction(resetPin.bind(null, workerId), null);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="New PIN" htmlFor="new-pin" hint="Leave empty to make one up. Their phone is logged out until they use it.">
        <input id="new-pin" name="pin" inputMode="numeric" pattern="\d{6,8}" maxLength={8} className={`${inputClass} max-w-40`} />
      </Field>
      <SubmitButton pending={pending} variant="secondary" pendingText="Resetting…">
        Reset PIN
      </SubmitButton>
      <ActionResult state={state} whatsappLabel="Send new PIN on WhatsApp" />
    </form>
  );
}
