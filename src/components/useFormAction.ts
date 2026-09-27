"use client";

import { startTransition, useActionState, type FormEvent } from "react";

// useActionState, but submitted from onSubmit: a form bound with `action={...}` is
// cleared by React after every submit, which would wipe what the user typed when the
// server answers with an error.
export function useFormAction<S>(
  action: (state: Awaited<S>, form: FormData) => S | Promise<S>,
  initial: Awaited<S>,
) {
  const [state, dispatch, pending] = useActionState<S, FormData>(action, initial);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => dispatch(form));
  }
  return [state, onSubmit, pending] as const;
}
