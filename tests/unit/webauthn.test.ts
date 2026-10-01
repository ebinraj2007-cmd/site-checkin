import { describe, expect, it } from "vitest";
import { decodeCbor, verifyAssertion, verifyRegistration, WebAuthnError } from "@/lib/webauthn";
import { AT, b64, cbor, RP, SoftPasskey, UP } from "./soft-passkey";

describe("decodeCbor", () => {
  it("reads maps, byte strings, text, negative numbers and nesting", () => {
    const value = decodeCbor(cbor(new Map<unknown, unknown>([["a", 1], [-7, Uint8Array.from([1, 2])], [3, [true, "x"]]]))).value;
    expect(value).toBeInstanceOf(Map);
    const map = value as Map<unknown, unknown>;
    expect(map.get("a")).toBe(1);
    expect(map.get(-7)).toEqual(Uint8Array.from([1, 2]));
    expect(map.get(3)).toEqual([true, "x"]);
  });
  it("refuses truncated or oversized input instead of reading past it", () => {
    expect(() => decodeCbor(Uint8Array.from([0x5a, 0xff, 0xff, 0xff, 0xff]))).toThrow(WebAuthnError);
    expect(() => decodeCbor(Uint8Array.from([0x9b, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff]))).toThrow(WebAuthnError);
    expect(() => decodeCbor(Uint8Array.from([0x9f]))).toThrow(WebAuthnError); // indefinite length
    expect(() => decodeCbor(new Uint8Array(40).fill(0x81))).toThrow(WebAuthnError); // too deep
  });
});

describe.each(["es256", "ed25519", "rs256"] as const)("passkeys with %s keys", (kind) => {
  it("register, then log in, with the counter moving on", () => {
    const passkey = new SoftPasskey(kind);
    const created = verifyRegistration(passkey.register("reg-challenge"), { ...RP, challenge: "reg-challenge" });
    expect(created.id).toBe(b64(passkey.id));
    const stored = { jwk: created.jwk, alg: created.alg, signCount: created.signCount };
    const first = verifyAssertion(passkey.login("login-1"), { ...RP, challenge: "login-1" }, stored);
    expect(first.signCount).toBe(1);
    // The same answer can't be replayed for another challenge.
    const answer = passkey.login("login-2");
    expect(() => verifyAssertion(answer, { ...RP, challenge: "login-3" }, { ...stored, signCount: 1 })).toThrow(WebAuthnError);
  });
});

describe("passkey checks", () => {
  const passkey = new SoftPasskey();
  const created = verifyRegistration(passkey.register("c"), { ...RP, challenge: "c" });
  const stored = { jwk: created.jwk, alg: created.alg, signCount: 0 };
  const expected = { ...RP, challenge: "c2" };

  it("refuses another site's origin or RP ID", () => {
    expect(() => verifyRegistration(passkey.register("c", { origin: "https://evil.example" }), { ...RP, challenge: "c" })).toThrow(
      "another site",
    );
    expect(() => verifyAssertion(passkey.login("c2", { rpId: "evil.example" }), expected, stored)).toThrow("another site");
  });
  it("needs the fingerprint, face or phone PIN, not just a tap", () => {
    expect(() => verifyRegistration(passkey.register("c", { flags: UP | AT }), { ...RP, challenge: "c" })).toThrow("Unlock");
    expect(() => verifyAssertion(passkey.login("c2", { flags: UP }), expected, stored)).toThrow("Unlock");
  });
  it("refuses a wrong kind of response or a wrong signature", () => {
    expect(() => verifyAssertion(passkey.login("c2", { type: "webauthn.create" }), expected, stored)).toThrow(WebAuthnError);
    const other = new SoftPasskey();
    const forged = other.login("c2");
    expect(() => verifyAssertion(forged, expected, stored)).toThrow("signature");
  });
  it("spots a copied passkey by its counter going backwards", () => {
    const answer = passkey.login("c2");
    expect(() => verifyAssertion(answer, expected, { ...stored, signCount: 50 })).toThrow("copied");
  });
  it("accepts passkeys that don't count (synced ones always send 0)", () => {
    const synced = new SoftPasskey("es256", false);
    const reg = verifyRegistration(synced.register("s"), { ...RP, challenge: "s" });
    expect(verifyAssertion(synced.login("s2"), { ...RP, challenge: "s2" }, { jwk: reg.jwk, alg: reg.alg, signCount: 0 }).signCount).toBe(0);
  });
});
