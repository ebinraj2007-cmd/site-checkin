"use client";

import type * as Leaflet from "leaflet";

// Leaflet touches `window` when imported, so load it only in the browser.
let leafletPromise: Promise<typeof Leaflet> | null = null;
export function loadLeaflet(): Promise<typeof Leaflet> {
  leafletPromise ??= import("leaflet").then((m) => (m.default ?? m) as typeof Leaflet);
  return leafletPromise;
}

export function baseMap(L: typeof Leaflet, el: HTMLElement, center: [number, number], zoom: number) {
  const map = L.map(el, { scrollWheelZoom: false }).setView(center, zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  return map;
}

// Teardrop pin drawn in SVG (Leaflet's default marker images don't survive bundling).
export function pinIcon(L: typeof Leaflet, color: string, size = 30) {
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))"><path fill="${color}" stroke="#fff" stroke-width="1.5" d="M12 22.5s-7.5-6.1-7.5-12a7.5 7.5 0 1 1 15 0c0 5.9-7.5 12-7.5 12Z"/><circle cx="12" cy="10.5" r="2.8" fill="#fff"/></svg>`,
  });
}

export function dotIcon(L: typeof Leaflet, color: string, label: string) {
  return L.divIcon({
    className: "",
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);color:#fff;font:700 11px/18px system-ui;text-align:center">${label}</div>`,
  });
}
