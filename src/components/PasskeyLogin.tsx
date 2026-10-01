"use client";

import { useEffect, useState } from "react";
import { loginWithPasskey, passkeyError, passkeysSupported } from "@/lib/webauthn-client";
import { Alert, buttonClass } from "./ui";

// "Log in with fingerprint or face", for phones that have a passkey for this site.
export function PasskeyLogin() {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Known only in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(passkeysSupported());
  }, []);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      // A full page load, so the new login cookie is used everywhere.
      window.location.assign(await loginWithPasskey());
    } catch (e) {
      setError(passkeyError(e));
      setBusy(false);
    }
  }

  if (!supported) return null;
  return (
    <div className="space-y-2">
      <button type="button" onClick={login} disabled={busy} className={buttonClass("secondary", "lg")}>
        <FingerprintIcon /> {busy ? "Waiting for your phone…" : "Log in with fingerprint or face"}
      </button>
      {error && <Alert tone="red">{error}</Alert>}
    </div>
  );
}

export function FingerprintIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M12 11v3a8 8 0 0 1-1 4" />
      <path d="M8.5 9.5A3.5 3.5 0 0 1 15.5 10v2a12 12 0 0 1-.6 3.8" />
      <path d="M5.6 7.5A7.5 7.5 0 0 1 19.5 11v1a16 16 0 0 1-.4 3.5" />
      <path d="M5 12a14 14 0 0 1-.4 3" />
      <path d="M8.6 13.5a11 11 0 0 1-1.4 5" />
    </svg>
  );
}
