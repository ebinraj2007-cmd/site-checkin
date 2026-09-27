"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState } from "react";
import { parseLocation, type LatLng } from "@/lib/geo";
import { baseMap, loadLeaflet, pinIcon } from "./leaflet";
import { buttonClass, inputClass } from "./ui";

type Result = { label: string; lat: number; lng: number };

// Job location: search an address, tap the map, use this phone's GPS, or paste a
// Google Maps link / "lat, lng". Writes hidden `lat` / `lng` inputs for the form.
export function MapPicker({
  defaultPoint,
  defaultAddress = "",
  fallbackCenter,
  radius,
}: {
  defaultPoint: LatLng | null;
  defaultAddress?: string;
  fallbackCenter: LatLng | null;
  radius: number;
}) {
  const [point, setPoint] = useState<LatLng | null>(defaultPoint);
  const [address, setAddress] = useState(defaultAddress);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const mapEl = useRef<HTMLDivElement>(null);
  const leaflet = useRef<{ L: typeof Leaflet; map: Leaflet.Map } | null>(null);
  const marker = useRef<Leaflet.Marker | null>(null);
  const circle = useRef<Leaflet.Circle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | undefined;
    loadLeaflet().then((L) => {
      if (cancelled || !mapEl.current) return;
      const start = defaultPoint ?? fallbackCenter;
      map = baseMap(L, mapEl.current, start ? [start.lat, start.lng] : [20, 10], defaultPoint ? 16 : start ? 12 : 2);
      map.on("click", (e: Leaflet.LeafletMouseEvent) => setPoint({ lat: e.latlng.lat, lng: e.latlng.lng }));
      leaflet.current = { L, map };
      setReady(true);
    });
    return () => {
      cancelled = true;
      map?.remove();
      leaflet.current = null;
      marker.current = null;
      circle.current = null;
    };
    // Map is created once; later changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const l = leaflet.current;
    if (!ready || !l || !point) return;
    const at: [number, number] = [point.lat, point.lng];
    if (!marker.current) {
      marker.current = l.L.marker(at, { icon: pinIcon(l.L, "#0f766e", 34), draggable: true }).addTo(l.map);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLatLng();
        setPoint({ lat: p.lat, lng: p.lng });
      });
      circle.current = l.L.circle(at, { radius, color: "#0f766e", weight: 1.5, fillOpacity: 0.12 }).addTo(l.map);
    } else {
      marker.current.setLatLng(at);
      circle.current!.setLatLng(at);
    }
    circle.current!.setRadius(radius);
  }, [point, radius, ready]);

  function flyTo(p: LatLng, zoom = 17) {
    setPoint(p);
    leaflet.current?.map.setView([p.lat, p.lng], zoom);
  }

  async function search() {
    if (!address.trim()) return;
    setBusy("search");
    setError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResults(data.results);
      if (!data.results.length) setError("No match. Try a shorter address, or tap the map.");
    } catch (e) {
      setError((e as Error).message || "Search failed. Tap the map instead.");
    } finally {
      setBusy(null);
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setError("This browser can't share its location.");
    setBusy("gps");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(null);
        flyTo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        setBusy(null);
        setError("Couldn't get your location. Allow location access, or tap the map.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function applyPaste(value: string) {
    setPaste(value);
    if (!value.trim()) return;
    setError(null);
    const direct = parseLocation(value);
    if (direct) return flyTo(direct);
    if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(value.trim())) {
      setBusy("paste");
      try {
        const res = await fetch(`/api/geocode?url=${encodeURIComponent(value.trim())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        flyTo(data);
      } catch (e) {
        setError((e as Error).message || "Couldn't read that link.");
      } finally {
        setBusy(null);
      }
      return;
    }
    setError("Paste a Google Maps link or coordinates like 25.2048, 55.2708.");
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="address" className="mb-1.5 block text-sm font-semibold text-slate-700">
          Address
        </label>
        <div className="flex gap-2">
          <input
            id="address"
            name="address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
            maxLength={300}
            placeholder="Building, street, area"
            className={inputClass}
          />
          <button type="button" onClick={search} disabled={busy !== null} className={buttonClass("secondary")}>
            {busy === "search" ? "…" : "Find"}
          </button>
        </div>
        {results && results.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => {
                    flyTo({ lat: r.lat, lng: r.lng });
                    setResults(null);
                  }}
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div ref={mapEl} className="h-72 w-full overflow-hidden rounded-xl border border-slate-300 bg-slate-200" />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={useMyLocation} disabled={busy !== null} className={buttonClass("secondary")}>
          {busy === "gps" ? "Locating…" : "Use my location"}
        </button>
        <input
          aria-label="Paste a Google Maps link or coordinates"
          value={paste}
          onChange={(e) => applyPaste(e.target.value)}
          placeholder="or paste Google Maps link / lat, lng"
          className={`${inputClass} min-w-0 flex-1 py-2 text-sm`}
        />
      </div>

      <p className={`text-sm ${point ? "text-slate-600" : "text-amber-700"}`}>
        {point
          ? `Pin: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}. Drag it to adjust. The circle is the check-in area.`
          : "Tap the map to drop the pin where the worker must be."}
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <input type="hidden" name="lat" value={point ? point.lat.toFixed(6) : ""} />
      <input type="hidden" name="lng" value={point ? point.lng.toFixed(6) : ""} />
    </div>
  );
}
