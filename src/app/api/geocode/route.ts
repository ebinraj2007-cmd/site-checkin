import { NextResponse } from "next/server";
import { apiUser, fail } from "@/lib/api";
import { isValidLatLng, parseLocation, type LatLng } from "@/lib/geo";

// Address search (OpenStreetMap Nominatim) and Google Maps short-link expansion for
// the job location picker. Managers only; one lookup per button press.
export async function GET(req: Request) {
  const user = await apiUser(req, { manager: true });
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim();
  const link = params.get("url")?.trim();

  if (q) {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q.slice(0, 200))}`,
      {
        headers: {
          "User-Agent": "site-checkin/1.0 (job check-in web app)",
          "Accept-Language": req.headers.get("accept-language") ?? "en",
        },
        signal: AbortSignal.timeout(8000),
      },
    ).catch(() => null);
    if (!res?.ok) return fail(502, "Address search isn't available right now. Tap the map instead.");
    const data = (await res.json()) as { display_name: string; lat: string; lon: string }[];
    const results = data
      .map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))
      .filter((r) => isValidLatLng(r.lat, r.lng));
    return NextResponse.json({ results });
  }

  if (link) {
    const point = await expandGoogleMapsLink(link).catch(() => null);
    if (!point) return fail(422, "Couldn't find a location in that link. Open it, then copy the full link from the address bar.");
    return NextResponse.json(point);
  }

  return fail(400, "Nothing to look up.");
}

const GOOGLE_HOST = /(^|\.)(goo\.gl|google\.[a-z]{2,3}(\.[a-z]{2})?)$/;

// Follows up to 5 redirects, only ever to Google hosts.
async function expandGoogleMapsLink(start: string): Promise<LatLng | null> {
  let current = start;
  for (let i = 0; i < 5; i++) {
    const url = new URL(current);
    if (url.protocol !== "https:" || !GOOGLE_HOST.test(url.hostname)) return null;
    const direct = parseLocation(current);
    if (direct) return direct;
    const res = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; site-checkin)" },
      signal: AbortSignal.timeout(8000),
    });
    const next = res.headers.get("location");
    if (!next) {
      const body = await res.text();
      const embedded = body.match(/https:\/\/www\.google\.[^"'\s<>]+\/maps[^"'\s<>]*/)?.[0];
      return embedded ? parseLocation(embedded) : null;
    }
    current = new URL(next, current).toString();
  }
  return parseLocation(current);
}
