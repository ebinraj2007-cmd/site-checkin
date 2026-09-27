"use client";

import { useTransition } from "react";
import { logout } from "@/app/actions";
import { buttonClass } from "./ui";

// Logging out also switches off job alerts on this device, so a shared phone stops
// showing the previous person's jobs.
export function LogoutButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={buttonClass("ghost")}
      onClick={() =>
        start(async () => {
          try {
            const reg = await navigator.serviceWorker?.getRegistration();
            const sub = await reg?.pushManager.getSubscription();
            if (sub) {
              await fetch("/api/push/subscribe", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: sub.endpoint }),
                signal: AbortSignal.timeout(3000),
              }).catch(() => {});
              await sub.unsubscribe().catch(() => {});
            }
          } catch {
            // logging out matters more than cleaning up
          }
          await logout();
        })
      }
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
