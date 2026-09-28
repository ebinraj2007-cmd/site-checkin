import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn(), generateVAPIDKeys: vi.fn() } }));

const { query } = await import("@/lib/db");
const webpush = (await import("web-push")).default;
const { isPushSubscription, notifyUsers } = await import("@/lib/push");

const keys = { p256dh: Buffer.alloc(65, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") };

describe("isPushSubscription", () => {
  it("accepts subscriptions from browser push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QGx",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
      "https://android.googleapis.com/gcm/send/abc",
    ]) {
      expect(isPushSubscription({ endpoint, keys })).toBe(true);
    }
  });
  it("refuses other hosts, plain http and malformed keys", () => {
    expect(isPushSubscription({ endpoint: "https://169.254.169.254/x", keys })).toBe(false);
    expect(isPushSubscription({ endpoint: "https://googleapis.com.evil.io/x", keys })).toBe(false);
    // Other Google hosts are not push services.
    expect(isPushSubscription({ endpoint: "https://storage.googleapis.com/bucket/x", keys })).toBe(false);
    expect(isPushSubscription({ endpoint: "https://fcm.googleapis.com:8443/fcm/send/abc", keys })).toBe(false);
    expect(isPushSubscription({ endpoint: "https://notify.windows.com.evil.io/w", keys })).toBe(false);
    expect(isPushSubscription({ endpoint: "http://fcm.googleapis.com/fcm/send/abc", keys })).toBe(false);
    expect(isPushSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, p256dh: "short" } })).toBe(false);
    expect(isPushSubscription({ endpoint: "https://fcm.googleapis.com/x", keys: { ...keys, auth: "!!" } })).toBe(false);
    expect(isPushSubscription(null)).toBe(false);
  });
});

describe("notifyUsers", () => {
  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    vi.mocked(query).mockReset();
    vi.mocked(webpush.sendNotification).mockReset();
  });

  it("does nothing without users", async () => {
    expect(await notifyUsers([], { title: "t", body: "b", url: "/" })).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it("sends to every device and forgets devices the push service no longer knows", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) =>
      sql.startsWith("SELECT endpoint")
        ? [
            { endpoint: "https://fcm.googleapis.com/fcm/send/live", ...keys },
            { endpoint: "https://fcm.googleapis.com/fcm/send/gone", ...keys },
            { endpoint: "https://web.push.apple.com/flaky", ...keys },
          ]
        : [],
    );
    vi.mocked(webpush.sendNotification).mockImplementation(async (sub) => {
      if (sub.endpoint.endsWith("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      if (sub.endpoint.endsWith("flaky")) throw Object.assign(new Error("Server error"), { statusCode: 500 });
      return { statusCode: 201, body: "", headers: {} };
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const sent = await notifyUsers(["u1", "u1", "u2"], { title: "New job", body: "AC service", url: "/w/jobs/1" });

    expect(sent).toBe(1);
    const select = vi.mocked(query).mock.calls[0];
    expect(select[0]).toContain("IN ($1, $2)");
    expect(select[1]).toEqual(["u1", "u2"]);
    expect(vi.mocked(webpush.sendNotification).mock.calls[0][1]).toBe(
      JSON.stringify({ title: "New job", body: "AC service", url: "/w/jobs/1" }),
    );
    const deletes = vi.mocked(query).mock.calls.filter(([sql]) => sql.startsWith("DELETE"));
    expect(deletes).toEqual([["DELETE FROM push_subscriptions WHERE endpoint = $1", ["https://fcm.googleapis.com/fcm/send/gone"]]]);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});
