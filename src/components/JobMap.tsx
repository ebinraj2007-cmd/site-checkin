"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";
import { baseMap, dotIcon, loadLeaflet, pinIcon } from "./leaflet";

export type MapPhoto = { lat: number; lng: number; kind: "arrival" | "work" | "leave"; label: string };

const COLORS = { arrival: "#0f766e", work: "#6366f1", leave: "#b45309" };
const LETTERS = { arrival: "A", work: "W", leave: "L" };

// Site pin + check-in circle, and a dot where each photo was taken.
export function JobMap({
  site,
  radius,
  photos,
}: {
  site: { lat: number; lng: number };
  radius: number;
  photos: MapPhoto[];
}) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([site, radius, photos]);

  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | undefined;
    loadLeaflet().then((L) => {
      if (cancelled || !el.current) return;
      map = baseMap(L, el.current, [site.lat, site.lng], 16);
      L.circle([site.lat, site.lng], { radius, color: "#0f766e", weight: 1.5, fillOpacity: 0.1 }).addTo(map);
      L.marker([site.lat, site.lng], { icon: pinIcon(L, "#0f172a", 30) }).addTo(map).bindPopup("Job site");
      const bounds = L.latLngBounds([[site.lat, site.lng]]);
      for (const p of photos) {
        L.marker([p.lat, p.lng], { icon: dotIcon(L, COLORS[p.kind], LETTERS[p.kind]) }).addTo(map).bindPopup(p.label);
        bounds.extend([p.lat, p.lng]);
      }
      if (photos.length) map.fitBounds(bounds.pad(0.4), { maxZoom: 17 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // `key` captures every input; the map is rebuilt only when the data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={el} className="h-64 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-200" />;
}
