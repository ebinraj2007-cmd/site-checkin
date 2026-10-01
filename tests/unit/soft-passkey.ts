import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

// A software passkey: makes registration and login responses the way a phone does.

export const RP = { rpId: "checkin.example.com", origin: "https://checkin.example.com" };
export const UP = 0x01;
export const UV = 0x04;
export const AT = 0x40;

export function cbor(value: unknown): Uint8Array {
  const out: number[] = [];
  const head = (major: number, n: number) => {
    if (n < 24) out.push((major << 5) | n);
    else if (n < 256) out.push((major << 5) | 24, n);
    else if (n < 65536) out.push((major << 5) | 25, n >> 8, n & 255);
    else out.push((major << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
  };
  const encode = (v: unknown) => {
    if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === "string") {
      const bytes = Buffer.from(v);
      head(3, bytes.length);
      return out.push(...bytes);
    }
    if (v instanceof Uint8Array) {
      head(2, v.length);
      return out.push(...v);
    }
    if (Array.isArray(v)) {
      head(4, v.length);
      return v.forEach(encode);
    }
    if (v instanceof Map) {
      head(5, v.size);
      for (const [k, x] of v) {
        encode(k);
        encode(x);
      }
      return;
    }
    if (v === true || v === false) return out.push(v ? 0xf5 : 0xf4);
    throw new Error(`can't encode ${String(v)}`);
  };
  encode(value);
  return Uint8Array.from(out);
}

export const b64 = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString("base64url");
const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest();

type Kind = "es256" | "ed25519" | "rs256";

export class SoftPasskey {
  readonly id = new Uint8Array(randomBytes(16));
  counter = 0;
  private key: KeyObject;
  private cose: Map<number, unknown>;
  // `counts`: false for a synced passkey, which always sends a counter of 0.
  constructor(
    private kind: Kind = "es256",
    private counts = true,
  ) {
    if (kind === "es256") {
      const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = pair.publicKey.export({ format: "jwk" });
      this.key = pair.privateKey;
      this.cose = new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, "base64url")], [-3, Buffer.from(jwk.y!, "base64url")]]);
    } else if (kind === "ed25519") {
      const pair = generateKeyPairSync("ed25519");
      const jwk = pair.publicKey.export({ format: "jwk" });
      this.key = pair.privateKey;
      this.cose = new Map<number, unknown>([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x!, "base64url")]]);
    } else {
      const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = pair.publicKey.export({ format: "jwk" });
      this.key = pair.privateKey;
      this.cose = new Map<number, unknown>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n!, "base64url")], [-2, Buffer.from(jwk.e!, "base64url")]]);
    }
  }

  private authData(rpId: string, flags: number, withKey: boolean) {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const parts = [sha256(rpId), Buffer.from([flags]), count];
    if (withKey) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.id.length);
      parts.push(Buffer.alloc(16), length, Buffer.from(this.id), Buffer.from(cbor(this.cose)));
    }
    return Buffer.concat(parts);
  }

  register(challenge: string, { rpId = RP.rpId, origin = RP.origin, flags = UP | UV | AT } = {}) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge, origin, crossOrigin: false }));
    const attestation = cbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", this.authData(rpId, flags, true)]]));
    return { clientDataJSON: b64(clientData), attestationObject: b64(attestation), transports: ["internal"] };
  }

  login(challenge: string, { rpId = RP.rpId, origin = RP.origin, flags = UP | UV, type = "webauthn.get" } = {}) {
    if (this.counts) this.counter += 1;
    const clientData = Buffer.from(JSON.stringify({ type, challenge, origin }));
    const authData = this.authData(rpId, flags, false);
    const signed = Buffer.concat([authData, sha256(clientData)]);
    const signature = this.kind === "ed25519" ? sign(null, signed, this.key) : sign("sha256", signed, this.key);
    return { clientDataJSON: b64(clientData), authenticatorData: b64(authData), signature: b64(signature) };
  }
}
