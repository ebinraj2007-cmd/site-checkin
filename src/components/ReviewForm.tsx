"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { ReviewFormState } from "@/app/m/review/actions";
import { useFlash } from "./Flash";
import { SubmitButton } from "./SubmitButton";
import { Alert, inputClass } from "./ui";

// Approve / Reject with an optional note for the worker. `movePin`: offer to move the job
// pin to where the photo was taken. `rejectWarning`: asked before rejecting. The result
// shows at the top of the page, since the item leaves the list once it's decided.
export function ReviewForm({
  action,
  movePin,
  rejectWarning,
}: {
  action: (state: ReviewFormState, form: FormData) => Promise<ReviewFormState>;
  movePin?: { checked: boolean };
  rejectWarning?: string;
}) {
  const flash = useFlash();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value === "reject" && rejectWarning && !window.confirm(rejectWarning)) return;
    const form = new FormData(e.currentTarget, submitter);
    setError(null);
    start(async () => {
      const result = await action(null, form);
      if (result?.error) setError(result.error);
      else if (result?.message) flash({ text: result.message, tone: "green" });
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2 rounded-xl bg-slate-50 p-3">
      <input name="note" maxLength={300} aria-label="Note for the worker" placeholder="Note for the worker (optional)" className={inputClass} />
      {movePin && (
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" name="move_pin" defaultChecked={movePin.checked} className="mt-0.5 h-4 w-4 accent-brand-700" />
          <span>Also move the job pin to where this photo was taken</span>
        </label>
      )}
      <div className="flex gap-2">
        <SubmitButton name="decision" value="approve" pending={pending} pendingText="…" className="flex-1">
          Approve
        </SubmitButton>
        <SubmitButton name="decision" value="reject" variant="danger" pending={pending} pendingText="…" className="flex-1">
          Reject
        </SubmitButton>
      </div>
      {error && <Alert tone="red">{error}</Alert>}
    </form>
  );
}
