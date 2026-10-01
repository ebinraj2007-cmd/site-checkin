import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";

// Passkey (WebAuthn) checks on the server: just what this app needs, no dependencies.
// Registration reads the new credential's public key from the authenticator data (no
// attestation: we don't need to know the phone's make); login checks the signature the
// phone made over the server's challenge with that key. Both need the user to have
// unlocked the passkey with their fingerprint, face or phone PIN ("user verified").

export class WebAuthnError extends Error {}

export type CborValue =
  | number
  | string
  | boolean
  | null
  | undefined
  | Uint8Array
  | CborValue[]
  | Map<CborValue, CborValue>;

// Decodes one CBOR item (the subset authenticators use: no tags, floats or indefinite
// lengths) starting at `offset`; `end` is where it stopped.
export function decodeCbor(data: Uint8Array, offset = 0): { value: CborValue; end: number } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = offset;
  const need = (n: number) => {
    if (n < 0 || pos + n > data.length) throw new WebAuthnError("Malformed CBOR: too short.");
  };
  const length = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) {
      need(1);
      return data[pos++];
    }
    if (info === 25) {
      need(2);
      pos += 2;
      return view.getUint16(pos - 2);
    }
    if (info === 26) {
      need(4);
      pos += 4;
      return view.getUint32(pos - 4);
    }
    if (info === 27) {
      need(8);
      pos += 8;
      const n = view.getBigUint64(pos - 8);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new WebAuthnError("Malformed CBOR: number too large.");
      return Number(n);
    }
    throw new WebAuthnError("Malformed CBOR: unsupported length.");
  };
  const item = (depth: number): CborValue => {
    if (depth > 16) throw new WebAuthnError("Malformed CBOR: nested too deep.");
    need(1);
    const head = data[pos++];
    const major = head >> 5;
    const info = head & 31;
    switch (major) {
      case 0:
        return length(info);
      case 1:
        return -1 - length(info);
      case 2: {
        const n = length(info);
        need(n);
        pos += n;
        return data.slice(pos - n, pos);
      }
      case 3: {
        const n = length(info);
        need(n);
        pos += n;
        return new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(pos - n, pos));
      }
      case 4: {
        const n = length(info);
        need(n); // every item takes at least a byte
        return Array.from({ length: n }, () => item(depth + 1));
      }
      case 5: {
        const n = length(info);
        need(n * 2);
        const map = new Map<CborValue, CborValue>();
        for (let i = 0; i < n; i++) {
          const key = item(depth + 1);
          map.set(key, item(depth + 1));
        }
        return map;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new WebAuthnError("Malformed CBOR: unsupported value.");
      default:
        throw new WebAuthnError("Malformed CBOR: unsupported type.");
    }
  };
  return { value: item(0), end: pos };
}

export const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function fromBase64Url(text: unknown): Uint8Array {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]*$/.test(text)) throw new WebAuthnError("Malformed response.");
  return new Uint8Array(Buffer.from(text, "base64url"));
}

const sha256 = (data: Uint8Array) => new Uint8Array(createHash("sha256").update(data).digest());
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

const UP = 0x01; // user present
const UV = 0x04; // user verified (fingerprint, face or phone PIN)
const BS = 0x10; // backed up (a synced passkey)
const AT = 0x40; // attested credential data follows

export type AuthData = {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credential?: { id: Uint8Array; publicKey: Map<CborValue, CborValue> };
};

export function parseAuthData(data: Uint8Array): AuthData {
  if (data.length < 37) throw new WebAuthnError("Malformed authenticator data.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = data[32];
  const result: AuthData = { rpIdHash: data.slice(0, 32), flags, signCount: view.getUint32(33) };
  if (flags & AT) {
    if (data.length < 55) throw new WebAuthnError("Malformed authenticator data.");
    const idLength = view.getUint16(53);
    if (55 + idLength > data.length || idLength === 0 || idLength > 1023) throw new WebAuthnError("Malformed credential ID.");
    const { value } = decodeCbor(data, 55 + idLength);
    if (!(value instanceof Map)) throw new WebAuthnError("Malformed public key.");
    result.credential = { id: data.slice(55, 55 + idLength), publicKey: value };
  }
  return result;
}

// COSE algorithm numbers the server accepts: ES256, EdDSA, RS256.
export const ALGORITHMS = [-7, -8, -257];

// A COSE public key → a JWK for node:crypto.
export function coseToJwk(key: Map<CborValue, CborValue>): { jwk: JsonWebKey; alg: number } {
  const kty = key.get(1);
  const alg = key.get(3);
  const bytes = (label: number, size?: number) => {
    const v = key.get(label);
    if (!(v instanceof Uint8Array) || (size !== undefined && v.length !== size)) throw new WebAuthnError("Malformed public key.");
    return toBase64Url(v);
  };
  if (kty === 2 && alg === -7 && key.get(-1) === 1) {
    return { jwk: { kty: "EC", crv: "P-256", x: bytes(-2, 32), y: bytes(-3, 32) }, alg };
  }
  if (kty === 1 && alg === -8 && key.get(-1) === 6) {
    return { jwk: { kty: "OKP", crv: "Ed25519", x: bytes(-2, 32) }, alg };
  }
  if (kty === 3 && alg === -257) {
    return { jwk: { kty: "RSA", n: bytes(-1), e: bytes(-2) }, alg };
  }
  throw new WebAuthnError("This kind of passkey isn't supported.");
}

export function verifySignature(jwk: JsonWebKey, alg: number, data: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    if (alg === -7) return verify("sha256", data, { key, dsaEncoding: "der" }, signature);
    if (alg === -257) return verify("sha256", data, key, signature);
    if (alg === -8) return verify(null, data, key, signature);
  } catch {
    // A malformed key or signature is just a failed check.
  }
  return false;
}

export type Expected = { challenge: string; origin: string; rpId: string };

function checkClientData(raw: Uint8Array, type: "webauthn.create" | "webauthn.get", expected: Expected) {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new WebAuthnError("Malformed response.");
  }
  if (data.type !== type) throw new WebAuthnError("Wrong kind of response.");
  if (data.challenge !== expected.challenge) throw new WebAuthnError("This took too long or was used before. Try again.");
  if (data.origin !== expected.origin || data.crossOrigin === true) throw new WebAuthnError("This passkey is for another site.");
}

function checkAuthData(auth: AuthData, expected: Expected) {
  if (!equal(auth.rpIdHash, sha256(new TextEncoder().encode(expected.rpId)))) {
    throw new WebAuthnError("This passkey is for another site.");
  }
  if (!(auth.flags & UP) || !(auth.flags & UV)) {
    throw new WebAuthnError("Unlock with your fingerprint, face or phone PIN to use this.");
  }
}

export type NewCredential = { id: string; jwk: JsonWebKey; alg: number; signCount: number; backedUp: boolean };

// A new passkey from navigator.credentials.create().
export function verifyRegistration(
  response: { clientDataJSON?: unknown; attestationObject?: unknown },
  expected: Expected,
): NewCredential {
  checkClientData(fromBase64Url(response.clientDataJSON), "webauthn.create", expected);
  const { value } = decodeCbor(fromBase64Url(response.attestationObject));
  const authData = value instanceof Map ? value.get("authData") : null;
  if (!(authData instanceof Uint8Array)) throw new WebAuthnError("Malformed response.");
  const auth = parseAuthData(authData);
  checkAuthData(auth, expected);
  if (!auth.credential) throw new WebAuthnError("The phone didn't send a passkey.");
  const { jwk, alg } = coseToJwk(auth.credential.publicKey);
  return {
    id: toBase64Url(auth.credential.id),
    jwk,
    alg,
    signCount: auth.signCount,
    backedUp: !!(auth.flags & BS),
  };
}

// A login with a known passkey (navigator.credentials.get()). Returns the new signature
// counter; a counter that went backwards means the passkey was copied.
export function verifyAssertion(
  response: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown },
  expected: Expected,
  stored: { jwk: JsonWebKey; alg: number; signCount: number },
): { signCount: number; backedUp: boolean } {
  const clientData = fromBase64Url(response.clientDataJSON);
  checkClientData(clientData, "webauthn.get", expected);
  const authData = fromBase64Url(response.authenticatorData);
  const auth = parseAuthData(authData);
  checkAuthData(auth, expected);
  const signed = new Uint8Array([...authData, ...sha256(clientData)]);
  if (!verifySignature(stored.jwk, stored.alg, signed, fromBase64Url(response.signature))) {
    throw new WebAuthnError("The passkey's signature is wrong.");
  }
  if ((auth.signCount !== 0 || stored.signCount !== 0) && auth.signCount <= stored.signCount) {
    throw new WebAuthnError("This passkey looks copied. Ask your manager to reset your login.");
  }
  return { signCount: auth.signCount, backedUp: !!(auth.flags & BS) };
}
