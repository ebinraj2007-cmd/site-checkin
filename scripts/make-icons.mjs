// Renders the app icons from inline SVG with the Playwright Chromium.
// Run: node scripts/make-icons.mjs  (writes public/icons/* and src/app/{icon,apple-icon}.png)
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const pin = (color, check) => `
  <path d="M256 448s-128-104-128-204a128 128 0 1 1 256 0c0 100-128 204-128 204Z" fill="${color}"/>
  <path d="m206 244 36 36 72-76" fill="none" stroke="${check}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`;

const full = (inset) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${inset ? 0 : 112}" fill="#0f766e"/>
  <g transform="translate(256 256) scale(${inset ? 0.72 : 0.9}) translate(-256 -262)">${pin("#ffffff", "#0f766e")}</g>
</svg>`;

// Notification badge: white silhouette on transparent (Android tints it).
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g transform="translate(256 256) scale(1.05) translate(-256 -262)">${pin("#ffffff", "transparent")}</g>
</svg>`;

const outputs = [
  ["public/icons/icon-192.png", full(false), 192],
  ["public/icons/icon-512.png", full(false), 512],
  ["public/icons/maskable-512.png", full(true), 512],
  ["public/icons/badge-96.png", badge, 96],
  ["src/app/icon.png", full(false), 64],
  ["src/app/apple-icon.png", full(true), 180],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [file, svg, size] of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await writeFile(file, await page.screenshot({ omitBackground: true }));
  console.log("wrote", file);
}
await browser.close();
