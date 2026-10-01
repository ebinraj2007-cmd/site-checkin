"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { passkeyError, platformPasskeys, registerPasskey } from "@/lib/webauthn-client";
import { FingerprintIcon } from "./PasskeyLogin";
import { Alert, buttonClass } from "./ui";

// Set up fingerprint / face login on this phone. `count`: passkeys this person already
// has; `required`: the company asks for it. Compact (the worker's home screen) shows
// nothing once it's set up.
export function PasskeySetup({ count, required, compact = false }: { count: number; required: boolean; compact?: boolean }) {
  const router = useRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    platformPasskeys().then((yes) => {
      if (!cancelled) setAvailable(yes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function setUp() {
    setBusy(true);
    setMessage(null);
    try {
      await registerPasskey();
      setMessage({ text: "Done. Next time, log in with your fingerprint or face.", ok: true });
      router.refresh();
    } catch (e) {
      setMessage({ text: passkeyError(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function removeAll() {
    if (!window.confirm("Turn off fingerprint and face login for your account on all your devices?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/passkeys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Couldn't turn it off.");
      setMessage({ text: "Fingerprint and face login are off. Log in with your PIN.", ok: true });
      router.refresh();
    } catch (e) {
      setMessage({ text: passkeyError(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (available === null) return null;
  if (compact && count > 0 && !message) return null;
  if (compact && !available) return null;

  const result = message && <Alert tone={message.ok ? "green" : "red"}>{message.text}</Alert>;
  if (count > 0) {
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-emerald-700">
          ✓ Fingerprint or face login is on ({count} device{count === 1 ? "" : "s"})
        </p>
        <div className="flex flex-wrap gap-2">
          {available && (
            <button type="button" onClick={setUp} disabled={busy} className={buttonClass("secondary")}>
              Add this device
            </button>
          )}
          {!required && (
            <button type="button" onClick={removeAll} disabled={busy} className={buttonClass("ghost")}>
              Turn off
            </button>
          )}
        </div>
        {result}
      </div>
    );
  }
  if (!available) {
    return <p className="text-sm text-slate-500">This device can&apos;t use fingerprint or face login.</p>;
  }
  return (
    <div className={`space-y-2 rounded-xl border p-3 ${required ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white"}`}>
      <p className="text-sm text-slate-800">
        <strong>{required ? "Your company asks you to log in with your fingerprint or face." : "Log in with your fingerprint or face."}</strong>{" "}
        It&apos;s quicker than your PIN, and nobody else can use it.
      </p>
      <button type="button" onClick={setUp} disabled={busy} className={buttonClass("primary")}>
        <FingerprintIcon /> {busy ? "Waiting for your phone…" : "Set up fingerprint login"}
      </button>
      {result}
    </div>
  );
}
