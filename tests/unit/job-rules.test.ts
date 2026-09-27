import { describe, expect, it } from "vitest";
import { isLate, missingSteps } from "@/lib/job-rules";
import { jobMessage } from "@/lib/messages";

const base = {
  require_work_photos: false,
  require_notes: false,
  notes: "",
  require_signature: false,
  signature_file: null,
};

describe("missingSteps", () => {
  it("is empty when nothing extra is required", () => {
    expect(missingSteps(base, [])).toEqual([]);
  });
  it("lists what's required and not done", () => {
    const job = { ...base, require_work_photos: true, require_notes: true, require_signature: true };
    expect(missingSteps(job, [{ kind: "arrival" }])).toEqual(["work photos", "notes", "customer signature"]);
    expect(missingSteps({ ...job, notes: "done", signature_file: "x.png" }, [{ kind: "work" }])).toEqual([]);
  });
  it("treats whitespace notes as missing", () => {
    expect(missingSteps({ ...base, require_notes: true, notes: "  \n" }, [])).toEqual(["notes"]);
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
