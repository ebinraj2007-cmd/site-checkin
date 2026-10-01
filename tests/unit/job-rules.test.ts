import { describe, expect, it } from "vitest";
import {
  isCurrentVisit,
  isLate,
  isRequestReason,
  isSkipReason,
  isStrongFlag,
  missingSteps,
  photoCounts,
  photoTimeProblem,
  type StepsJob,
} from "@/lib/job-rules";
import { customerCodeMessage, jobMessage } from "@/lib/messages";

const base: StepsJob = {
  require_work_photos: false,
  require_notes: false,
  notes: "",
  require_signature: false,
  signature_file: null,
  require_customer_code: false,
  code_confirmed_at: null,
};
const photo = (kind: "arrival" | "work" | "leave", review: "none" | "pending" | "approved" | "rejected" = "none") => ({ kind, review });
const skip = (step: "signature" | "code", review: "pending" | "approved" | "rejected") => ({ step, review });

describe("missingSteps", () => {
  it("is empty when nothing extra is required", () => {
    expect(missingSteps(base, [])).toEqual([]);
  });
  it("lists what's required and not done", () => {
    const job = { ...base, require_work_photos: true, require_notes: true, require_signature: true, require_customer_code: true };
    expect(missingSteps(job, [photo("arrival")])).toEqual(["work photos", "notes", "customer code", "customer signature"]);
    expect(
      missingSteps({ ...job, notes: "done", signature_file: "x.png", code_confirmed_at: new Date() }, [photo("work")]),
    ).toEqual([]);
  });
  it("treats whitespace notes as missing", () => {
    expect(missingSteps({ ...base, require_notes: true, notes: "  \n" }, [])).toEqual(["notes"]);
  });
  it("counts a work photo waiting for review, but not a rejected one", () => {
    const job = { ...base, require_work_photos: true };
    expect(missingSteps(job, [photo("work", "pending")])).toEqual([]);
    expect(missingSteps(job, [photo("work", "rejected")])).toEqual(["work photos"]);
    expect(missingSteps(job, [photo("work", "rejected"), photo("work", "approved")])).toEqual([]);
  });
  it("accepts a customer step skipped with a reason, until the manager rejects the skip", () => {
    const job = { ...base, require_signature: true };
    expect(missingSteps(job, [], [skip("signature", "pending")])).toEqual([]);
    expect(missingSteps(job, [], [skip("signature", "approved")])).toEqual([]);
    expect(missingSteps(job, [], [skip("signature", "rejected")])).toEqual(["customer signature"]);
    // Skipped again after a refusal: waiting for review again.
    expect(missingSteps(job, [], [skip("signature", "rejected"), skip("signature", "pending")])).toEqual([]);
    // Skipping one step doesn't excuse the other.
    expect(missingSteps({ ...job, require_customer_code: true }, [], [skip("signature", "approved")])).toEqual(["customer code"]);
  });
});

describe("reviews", () => {
  it("counts a photo unless it waits for review or was rejected", () => {
    expect(photoCounts({ review: "none" })).toBe(true);
    expect(photoCounts({ review: "approved" })).toBe(true);
    expect(photoCounts({ review: "pending" })).toBe(false);
    expect(photoCounts({ review: "rejected" })).toBe(false);
  });
  it("knows its reasons and which warning signs need a review", () => {
    expect(isRequestReason("pin_wrong")).toBe(true);
    expect(isRequestReason("toString")).toBe(false);
    expect(isRequestReason(undefined)).toBe(false);
    expect(isSkipReason("customer_absent")).toBe(true);
    expect(isSkipReason("__proto__")).toBe(false);
    expect(isStrongFlag({ code: "duplicate_photo" })).toBe(true);
    expect(isStrongFlag({ code: "ip_country" })).toBe(false);
  });
});

describe("photoTimeProblem", () => {
  const now = new Date("2026-09-27T10:00:00Z");
  const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
  it("accepts a photo sent within 15 minutes, allowing for a slightly fast phone clock", () => {
    expect(photoTimeProblem(minutes(0), now)).toBeNull();
    expect(photoTimeProblem(minutes(-14), now)).toBeNull();
    expect(photoTimeProblem(minutes(5), now)).toBeNull();
  });
  it("refuses a photo taken long before it was sent", () => {
    expect(photoTimeProblem(minutes(-16), now)).toContain("more than 15 minutes ago");
    expect(photoTimeProblem(minutes(-300), now)).toContain("Take a new photo at the site");
  });
  it("refuses a missing time, and a clock set ahead to make an old photo look new", () => {
    expect(photoTimeProblem(null, now)).toContain("time is missing");
    expect(photoTimeProblem(minutes(11), now)).toContain("clock is ahead");
  });
});

describe("isCurrentVisit", () => {
  const arrived_at = new Date("2026-09-27T09:00:00Z");
  it("counts photos from the arrival photo on", () => {
    expect(isCurrentVisit({ arrived_at }, { created_at: arrived_at })).toBe(true);
    expect(isCurrentVisit({ arrived_at }, { created_at: new Date("2026-09-27T09:30:00Z") })).toBe(true);
  });
  it("leaves out photos from before a reopen, and everything before the new arrival", () => {
    expect(isCurrentVisit({ arrived_at }, { created_at: new Date("2026-09-26T15:00:00Z") })).toBe(false);
    expect(isCurrentVisit({ arrived_at: null }, { created_at: arrived_at })).toBe(false);
  });
});

describe("isLate", () => {
  const now = new Date("2026-09-27T10:00:00Z");
  it("is late 15 minutes after the start with no arrival", () => {
    expect(isLate({ status: "assigned", scheduled_at: new Date("2026-09-27T09:44:00Z") }, now)).toBe(true);
    expect(isLate({ status: "assigned", scheduled_at: new Date("2026-09-27T09:46:00Z") }, now)).toBe(false);
  });
  it("is never late once arrived or without a time", () => {
    expect(isLate({ status: "arrived", scheduled_at: new Date("2026-09-27T08:00:00Z") }, now)).toBe(false);
    expect(isLate({ status: "assigned", scheduled_at: null }, now)).toBe(false);
  });
});

describe("jobMessage", () => {
  it("includes the job link, directions and the time in the company timezone", () => {
    const text = jobMessage(
      {
        id: "abc",
        title: "AC service",
        address: "Villa 12, Jumeirah",
        scheduled_at: new Date("2026-09-27T06:00:00Z"),
        site_lat: 25.2,
        site_lng: 55.27,
        customer_name: "Ali",
        customer_phone: "971500000000",
        instructions: "Gate code 1234",
      },
      "https://checkin.example.com",
      "Asia/Dubai",
      "Ravi Kumar",
    );
    expect(text).toContain("Hi Ravi");
    expect(text).toContain("*AC service*");
    expect(text).toMatch(/When: Sun 27 Sept?, 10:00 AM/); // a date, not "Today": it's read later
    expect(text).toContain("destination=25.2,55.27");
    expect(text).toContain("Customer: Ali, +971 50 000 0000");
    expect(text).toContain("https://checkin.example.com/w/jobs/abc");
  });
});

describe("customerCodeMessage", () => {
  it("gives the customer the code, the job and the visit time", () => {
    const text = customerCodeMessage(
      { title: "AC service", scheduled_at: new Date("2026-09-27T06:00:00Z"), customer_name: "Ali Hassan" },
      "0472",
      "Cool Air",
      "Asia/Dubai",
    );
    expect(text).toContain("Hello Ali, this is Cool Air.");
    expect(text).toContain("*AC service*");
    expect(text).toMatch(/Sun 27 Sept?, 10:00 AM/);
    expect(text).toContain("*0472*");
  });
});
