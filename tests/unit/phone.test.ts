import { describe, expect, it } from "vitest";
import { normalizePhone, whatsappLink } from "@/lib/phone";

describe("normalizePhone", () => {
  it("keeps international numbers", () => {
    expect(normalizePhone("+971 50 123 4567", "971")).toBe("971501234567");
    expect(normalizePhone("+44 7700 900123")).toBe("447700900123");
    expect(normalizePhone("00971501234567", "971")).toBe("971501234567");
  });
  it("adds the company country code to local numbers", () => {
    expect(normalizePhone("050 123 4567", "971")).toBe("971501234567");
    expect(normalizePhone("(050) 123-4567", "+971")).toBe("971501234567");
  });
  it("doesn't add the country code twice", () => {
    expect(normalizePhone("971501234567", "971")).toBe("971501234567");
  });
  it("rejects junk", () => {
    expect(normalizePhone("", "971")).toBeNull();
    expect(normalizePhone("12345", "")).toBeNull();
    expect(normalizePhone("+1234567890123456", "")).toBeNull();
  });
});

describe("whatsappLink", () => {
  it("builds a wa.me link with the text encoded", () => {
    expect(whatsappLink("971501234567", "Hi & bye\nnext")).toBe("https://wa.me/971501234567?text=Hi%20%26%20bye%0Anext");
  });
});
