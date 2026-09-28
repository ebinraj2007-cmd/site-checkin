import { describe, expect, it } from "vitest";
import { checkOnSite, distanceMeters, formatDistance, isGoogleMapsFetchable, parseLocation } from "@/lib/geo";

const site = { lat: 25.2048, lng: 55.2708, radius: 150 };

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(site, site)).toBe(0);
  });
  it("one degree of longitude on the equator is about 111.2 km", () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) / 1000).toBeCloseTo(111.195, 2);
  });
  it("0.001° of latitude is about 111 m", () => {
    expect(distanceMeters(site, { lat: site.lat + 0.001, lng: site.lng })).toBeCloseTo(111.2, 0);
  });
});

describe("checkOnSite", () => {
  it("accepts a reading inside the circle", () => {
    const r = checkOnSite(site, { lat: site.lat + 0.001, lng: site.lng, accuracy: 10 });
    expect(r.ok).toBe(true);
  });
  it("gives up to 50 m of GPS accuracy as allowance", () => {
    const at180m = { lat: site.lat + 0.00162, lng: site.lng };
    expect(checkOnSite(site, { ...at180m, accuracy: 10 }).ok).toBe(false);
    expect(checkOnSite(site, { ...at180m, accuracy: 40 }).ok).toBe(true);
    expect(checkOnSite(site, { lat: site.lat + 0.0025, lng: site.lng, accuracy: 150 }).ok).toBe(false);
  });
  it("refuses a far-away reading with the distance in the message", () => {
    const r = checkOnSite(site, { lat: site.lat + 0.01, lng: site.lng, accuracy: 8 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("too-far");
      expect(r.message).toContain("1.1 km");
    }
  });
  it("refuses a weak GPS fix even on site", () => {
    const r = checkOnSite(site, { lat: site.lat, lng: site.lng, accuracy: 900 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("weak-gps");
  });
  it("refuses NaN accuracy", () => {
    expect(checkOnSite(site, { lat: site.lat, lng: site.lng, accuracy: Number.NaN }).ok).toBe(false);
  });
});

describe("parseLocation", () => {
  it("reads plain coordinates", () => {
    expect(parseLocation("25.2048, 55.2708")).toEqual({ lat: 25.2048, lng: 55.2708 });
    expect(parseLocation("-33.8688,151.2093")).toEqual({ lat: -33.8688, lng: 151.2093 });
  });
  it("prefers the exact place pin in a Google Maps place link", () => {
    const url =
      "https://www.google.com/maps/place/Burj+Khalifa/@25.1971,55.2711,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d25.1972!4d55.2744";
    expect(parseLocation(url)).toEqual({ lat: 25.1972, lng: 55.2744 });
  });
  it("reads ?q= and @ view links", () => {
    expect(parseLocation("https://maps.google.com/?q=25.1,55.2")).toEqual({ lat: 25.1, lng: 55.2 });
    expect(parseLocation("https://www.google.com/maps/@25.3,55.4,15z")).toEqual({ lat: 25.3, lng: 55.4 });
    expect(parseLocation("https://www.google.com/maps/search/?api=1&query=25.5%2C55.6")).toEqual({ lat: 25.5, lng: 55.6 });
  });
  it("rejects text without coordinates and out-of-range numbers", () => {
    expect(parseLocation("Dubai Marina")).toBeNull();
    expect(parseLocation("95.1, 55.2")).toBeNull();
  });
});

describe("formatDistance", () => {
  it("uses metres below 1 km", () => {
    expect(formatDistance(35.4)).toBe("35 m");
    expect(formatDistance(1234)).toBe("1.2 km");
    expect(formatDistance(23_456)).toBe("23 km");
  });
});

describe("isGoogleMapsFetchable", () => {
  it("allows Google Maps short links and the pages they lead to", () => {
    for (const link of [
      "https://maps.app.goo.gl/AbCdEf123",
      "https://goo.gl/maps/xyz",
      "https://www.google.com/maps/place/x",
      "https://maps.google.com/?cid=1",
    ]) {
      expect(isGoogleMapsFetchable(link)).toBe(true);
    }
  });
  it("refuses look-alike and other hosts", () => {
    for (const link of [
      "https://google.biz.id/maps",
      "https://google.me.uk/x",
      "https://google.xyz/x",
      "https://google.com.de/x",
      "https://maps.app.goo.gl.evil.io/x",
      "http://maps.app.goo.gl/x",
      "https://www.google.com:8080/maps",
      "not a link",
    ]) {
      expect(isGoogleMapsFetchable(link)).toBe(false);
    }
  });
});
