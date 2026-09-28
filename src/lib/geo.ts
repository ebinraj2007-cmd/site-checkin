export type LatLng = { lat: number; lng: number };

// Readings less precise than this are rejected instead of guessed at.
export const MAX_GPS_ACCURACY_M = 200;
// Phone GPS drifts; give this much of the reported accuracy as benefit of the doubt.
export const ACCURACY_ALLOWANCE_M = 50;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SiteCheck =
  | { ok: true; distance: number }
  | { ok: false; distance: number; reason: "too-far" | "weak-gps"; message: string };

// The one rule for "is this person at the site". The phone runs it to guide the worker;
// the server runs it again on upload and its answer is the one that counts.
export function checkOnSite(
  site: LatLng & { radius: number },
  pos: LatLng & { accuracy: number },
): SiteCheck {
  const distance = distanceMeters(site, pos);
  if (!(pos.accuracy <= MAX_GPS_ACCURACY_M)) {
    return {
      ok: false,
      distance,
      reason: "weak-gps",
      message: `GPS signal is too weak (±${Math.round(pos.accuracy)} m). Step outside or wait a few seconds, then try again.`,
    };
  }
  if (distance > site.radius + Math.min(pos.accuracy, ACCURACY_ALLOWANCE_M)) {
    return {
      ok: false,
      distance,
      reason: "too-far",
      message: `You are ${formatDistance(distance)} from the job site. You can check in when you are within ${formatDistance(site.radius)}.`,
    };
  }
  return { ok: true, distance };
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function isValidLatLng(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

const PAIR = "(-?\\d{1,2}(?:\\.\\d+)?)\\s*,\\s*(-?\\d{1,3}(?:\\.\\d+)?)";

// Accepts "25.2048, 55.2708" or a Google Maps link that contains coordinates.
// The hosts /api/geocode may fetch while expanding a short link (maps.app.goo.gl) to the
// map page it points to. Coordinates in any other link are read without fetching it.
const GOOGLE_MAPS_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "google.com",
  "www.google.com",
  "maps.google.com",
  "consent.google.com",
]);

export function isGoogleMapsFetchable(link: string): boolean {
  try {
    const url = new URL(link);
    return url.protocol === "https:" && url.port === "" && GOOGLE_MAPS_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

// Short links (maps.app.goo.gl) must be expanded first; see /api/geocode.
export function parseLocation(input: string): LatLng | null {
  const text = decodeURIComponentSafe(input.trim());
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // exact place pin
    new RegExp(`[?&](?:q|query|ll|destination|center|daddr)=(?:loc:)?${PAIR}`),
    new RegExp(`@${PAIR}`), // map view centre
    new RegExp(`^${PAIR}$`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (isValidLatLng(lat, lng)) return { lat, lng };
  }
  return null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function mapsLink(p: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
}

export function directionsLink(p: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
}
