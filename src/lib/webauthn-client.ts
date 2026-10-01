// Passkeys in the browser: turns the server's options (base64url strings) into what
// navigator.credentials wants, and the phone's answer back into JSON. Browser only.

const toBuffer = (text: string): ArrayBuffer => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
};

const toText = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials?.create;
}

// Whether this device has a fingerprint, face or PIN unlock for passkeys.
export async function platformPasskeys(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false);
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

// What went wrong, in words for the person holding the phone.
export function passkeyError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelled, or the phone didn't confirm it's you. Try again.";
  if (name === "InvalidStateError") return "This phone already has fingerprint login for you.";
  if (name === "NotSupportedError" || name === "SecurityError") return "This phone or browser can't use fingerprint login.";
  if (e instanceof TypeError) return "No internet connection. Try again when you have signal.";
  return (e as Error)?.message || "Something went wrong. Try again.";
}

type ServerCreation = {
  challengeId: string;
  publicKey: Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
    challenge: string;
    user: { id: string; name: string; displayName: string };
    excludeCredentials: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
  };
};

// Makes a passkey for the logged-in person on this device and saves it.
export async function registerPasskey(): Promise<void> {
  const { challengeId, publicKey } = (await post("/api/passkeys/options", { purpose: "register" })) as ServerCreation;
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...publicKey,
      challenge: toBuffer(publicKey.challenge),
      user: { ...publicKey.user, id: toBuffer(publicKey.user.id) },
      excludeCredentials: publicKey.excludeCredentials.map((c) => ({ ...c, id: toBuffer(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("The phone didn't make a passkey.");
  const response = credential.response as AuthenticatorAttestationResponse;
  await post("/api/passkeys/register", {
    challengeId,
    credential: {
      id: credential.id,
      type: credential.type,
      response: {
        clientDataJSON: toText(response.clientDataJSON),
        attestationObject: toText(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
    },
  });
}

type ServerRequest = {
  publicKey: Omit<PublicKeyCredentialRequestOptions, "challenge"> & { challenge: string };
};

// Logs in with a passkey on this device; returns where to go next.
export async function loginWithPasskey(): Promise<string> {
  const { publicKey } = (await post("/api/passkeys/options", { purpose: "login" })) as ServerRequest;
  const credential = (await navigator.credentials.get({
    publicKey: { ...publicKey, challenge: toBuffer(publicKey.challenge) },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("The phone didn't confirm it's you.");
  const response = credential.response as AuthenticatorAssertionResponse;
  const data = await post("/api/passkeys/login", {
    challenge: publicKey.challenge,
    credential: {
      id: credential.id,
      type: credential.type,
      response: {
        clientDataJSON: toText(response.clientDataJSON),
        authenticatorData: toText(response.authenticatorData),
        signature: toText(response.signature),
        userHandle: response.userHandle ? toText(response.userHandle) : null,
      },
    },
  });
  return data.redirect ?? "/";
}
