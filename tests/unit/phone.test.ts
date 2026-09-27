import { describe, expect, it } from "vitest";
import { displayPhone, normalizePhone, whatsappLink } from "@/lib/phone";

describe("normalizePhone", () => {
  it("gives the same number however it is typed", () => {
    for (const typed of ["050 123 4567", "+971 50 123 4567", "00971501234567", "971501234567", "(050) 123-4567"]) {
      expect(normalizePhone(typed, "971")).toBe("971501234567");
    }
  });
  it("handles national numbers that start with the country code digits (India)", () => {
    expect(normalizePhone("91234 56789", "91")).toBe("919123456789");
    expect(normalizePhone("+91 91234 56789", "91")).toBe("919123456789");
    expect(normalizePhone("919123456789", "91")).toBe("919123456789");
  });
  it("keeps other countries' numbers typed with +", () => {
    expect(normalizePhone("+44 7911 123456", "971")).toBe("447911123456");
  });
  it("needs a country code for local numbers", () => {
    expect(normalizePhone("050 123 4567", "")).toBeNull();
    expect(normalizePhone("+971 50 123 4567", "")).toBe("971501234567");
  });
  it("rejects numbers that can't exist", () => {
    expect(normalizePhone("", "971")).toBeNull();
    expect(normalizePhone("12345", "971")).toBeNull();
    expect(normalizePhone("+1234567890123456", "")).toBeNull();
  });
});

describe("displayPhone", () => {
  it("formats stored digits for people", () => {
    expect(displayPhone("971501234567")).toBe("+971 50 123 4567");
    expect(displayPhone("")).toBe("");
  });
});

describe("whatsappLink", () => {
  it("builds a wa.me link with the text encoded", () => {
    expect(whatsappLink("971501234567", "Hi & bye\nnext")).toBe("https://wa.me/971501234567?text=Hi%20%26%20bye%0Anext");
  });
});
