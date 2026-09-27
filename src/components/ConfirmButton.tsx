"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

// Submit button that asks first. Use inside a <form action={serverAction}>.
export function ConfirmButton({
  children,
  confirm,
  variant = "danger",
}: {
  children: ReactNode;
  confirm: string;
  variant?: "danger" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant)}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
