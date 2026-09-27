"use client";

import { useEffect, useState } from "react";
import { Alert, buttonClass } from "./ui";

type Status = "checking" | "unsupported" | "needs-install" | "blocked" | "off" | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// "Turn on job alerts" for this phone: explains the iPhone home-screen step, asks for
// permission, and registers the push subscription with the server.
export function PushSetup({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: Status;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        next = isIos() && !isStandalone() ? "needs-install" : "unsupported";
      } else if (Notification.permission === "denied") {
        next = "blocked";
      } else {
        const sub = await currentSubscription().catch(() => null);
        if (sub) {
          // Re-send, in case the server lost it (e.g. worker logged in on a shared phone).
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub),
          }).catch(() => {});
        }
        next = sub ? "on" : "off";
      }
      if (!cancelled) setStatus(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "blocked" : "off");
        return;
      }
      const { publicKey } = await (await fetch("/api/push/key")).json();
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save.");
      setStatus("on");
      setMessage("Job alerts are on for this phone.");
    } catch (e) {
      setMessage(`Couldn't turn on alerts: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = await res.json();
      setMessage(data.sent ? "Test sent. It should pop up in a few seconds." : "No device received it. Try turning alerts off and on.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  }

  if (status === "checking") return null;
  if (status === "on" && compact) return null;

  return (
    <div className="space-y-2">
      {status === "needs-install" && (
        <Alert tone="amber">
          <strong>iPhone:</strong> to get job alerts, tap the Share button{" "}
          <span aria-hidden="true">⬆︎</span> in Safari, choose <strong>Add to Home Screen</strong>, then open the app
          from your home screen and turn on alerts there.
        </Alert>
      )}
      {status === "unsupported" && (
        <Alert tone="amber">This browser can&apos;t show job alerts. Use Chrome on Android or Safari on iPhone.</Alert>
      )}
      {status === "blocked" && (
        <Alert tone="red">
          Notifications are blocked for this app. Allow them in your phone&apos;s browser or app settings, then reload.
        </Alert>
      )}
      {status === "off" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="min-w-0 flex-1 text-sm text-amber-900">
            <strong>Job alerts are off.</strong> Turn them on so new jobs pop up on this phone.
          </p>
          <button type="button" onClick={turnOn} disabled={busy} className={buttonClass("primary")}>
            {busy ? "…" : "Turn on job alerts"}
          </button>
        </div>
      )}
      {status === "on" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-emerald-700">✓ Job alerts are on for this device</span>
          <button type="button" onClick={sendTest} disabled={busy} className={buttonClass("secondary")}>
            Send test
          </button>
          <button type="button" onClick={turnOff} disabled={busy} className={buttonClass("ghost")}>
            Turn off
          </button>
        </div>
      )}
      {message && <p className="text-sm text-slate-600">{message}</p>}
    </div>
  );
}
