import Link from "next/link";
import type { ReactNode } from "react";
import { formatDistance, mapsLink } from "@/lib/geo";
import { FLAGS, isStrongFlag, REQUEST_REASONS, type JobPhoto } from "@/lib/job-rules";
import { countryName } from "@/lib/phone";
import { formatDateTime, formatDuration, formatStamp } from "@/lib/time";
import { Badge } from "./ui";

// A gap this size between the phone's shutter time and the server's receipt is worth showing.
const NOTABLE_GAP = 2 * 60_000;

// One proof photo with what the server recorded about it: distance, GPS, warning signs,
// the worker's reason if they sent it for approval, and the manager's review. `children`
// go at the bottom (e.g. the review buttons).
export function PhotoTile({
  photo,
  tz,
  radius,
  compact = false,
  label,
  children,
}: {
  photo: JobPhoto;
  tz: string;
  radius: number;
  compact?: boolean;
  label?: string;
  children?: ReactNode;
}) {
  const src = `/api/files/${photo.file_key}`;
  const selfie = photo.selfie_key ? `/api/files/${photo.selfie_key}` : null;
  const located = photo.lat !== null && photo.lng !== null;
  // Received minus taken (by the phone's clock): late sends, or a phone clock that's off.
  const gap = photo.device_time ? photo.created_at.getTime() - photo.device_time.getTime() : 0;
  const flags = [...(photo.flags ?? [])].sort((a, b) => Number(isStrongFlag(b)) - Number(isStrongFlag(a)));
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="relative">
        <a href={src} target="_blank" rel="noopener noreferrer" className="block bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
          <img
            src={src}
            alt={`${photo.kind} photo`}
            loading="lazy"
            className={`w-full object-contain ${compact ? "aspect-square object-cover" : "max-h-96"}`}
          />
        </a>
        {selfie && !compact && (
          <a
            href={selfie}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-2 right-2 block overflow-hidden rounded-lg border-2 border-white shadow-lg"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
            <img src={selfie} alt="Selfie" loading="lazy" className="h-24 w-18 bg-slate-800 object-cover" />
          </a>
        )}
        {compact && (photo.review === "pending" || photo.review === "rejected") && (
          <span className="absolute top-1 left-1">
            <Badge tone={photo.review === "pending" ? "amber" : "red"}>{photo.review === "pending" ? "Review" : "Rejected"}</Badge>
          </span>
        )}
      </div>
      {!compact && (
        <figcaption className="space-y-2 p-3 text-sm">
          <p className="font-semibold text-slate-800">
            {label && `${label} · `}
            {formatDateTime(photo.created_at, tz)}
            {photo.user_name && <span className="font-normal text-slate-500"> · by {photo.user_name}</span>}
          </p>
          <ReviewStatus photo={photo} tz={tz} />
          <div className="flex flex-wrap gap-1.5">
            {photo.distance_m !== null && (
              <Badge tone={photo.on_site ? "green" : "red"}>
                {formatDistance(photo.distance_m)} from site{photo.on_site ? "" : ` (limit ${formatDistance(radius)})`}
              </Badge>
            )}
            {photo.accuracy_m !== null && <Badge tone="slate">GPS ±{Math.round(photo.accuracy_m)} m</Badge>}
            {!located && <Badge tone="amber">No GPS</Badge>}
            {!photo.live_camera && <Badge tone="amber">Not live camera</Badge>}
            {gap > NOTABLE_GAP && <Badge tone="amber">Sent {formatDuration(gap)} after it was taken</Badge>}
            {gap < -NOTABLE_GAP && <Badge tone="amber">Phone clock {formatDuration(-gap)} ahead</Badge>}
          </div>
          {flags.length > 0 && (
            <ul className="space-y-1.5" aria-label="Warning signs">
              {flags.map((f, i) => (
                <li key={i} className="text-xs text-slate-600">
                  <Badge tone={isStrongFlag(f) ? "red" : "amber"}>{FLAGS[f.code]?.label ?? f.code}</Badge>{" "}
                  {f.detail}
                  {f.jobId && f.jobId !== photo.job_id && (
                    <>
                      {" "}
                      <Link href={`/m/jobs/${f.jobId}`} className="font-semibold text-brand-700">
                        Open that job →
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {located && (
              <a
                href={mapsLink({ lat: photo.lat!, lng: photo.lng! })}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-brand-700"
              >
                Where it was taken →
              </a>
            )}
            <Evidence photo={photo} tz={tz} />
          </div>
          {children}
        </figcaption>
      )}
    </figure>
  );
}

function ReviewStatus({ photo, tz }: { photo: JobPhoto; tz: string }) {
  const reason = photo.request_reason ? REQUEST_REASONS[photo.request_reason] : null;
  if (photo.review === "none" && !reason) return null;
  const by = photo.reviewer_name ? ` by ${photo.reviewer_name}` : "";
  const when = photo.reviewed_at ? ` · ${formatDateTime(photo.reviewed_at, tz)}` : "";
  return (
    <div className="space-y-1 rounded-lg bg-slate-50 p-2">
      {photo.review === "pending" && <Badge tone="amber">Waiting for review</Badge>}
      {photo.review === "approved" && (
        <Badge tone="green">
          Approved{by}
          {when}
        </Badge>
      )}
      {photo.review === "rejected" && (
        <Badge tone="red">
          Rejected{by}
          {when}
        </Badge>
      )}
      {reason && (
        <p className="text-xs text-slate-700">
          <span className="font-semibold">Sent for approval:</span> {reason}
          {photo.request_note && <span className="italic"> “{photo.request_note}”</span>}
        </p>
      )}
      {photo.review_note && (
        <p className="text-xs text-slate-700">
          <span className="font-semibold">Manager&apos;s note:</span> {photo.review_note}
        </p>
      )}
    </div>
  );
}

// The raw details on record, for when a check-in is disputed.
function Evidence({ photo, tz }: { photo: JobPhoto; tz: string }) {
  const rows: [string, string][] = [];
  rows.push(["Received", formatStamp(photo.created_at, tz)]);
  if (photo.device_time) rows.push(["Taken (phone clock)", formatStamp(photo.device_time, tz)]);
  if (photo.fix_time) rows.push(["GPS reading (phone clock)", formatStamp(photo.fix_time, tz)]);
  if (photo.lat !== null && photo.lng !== null) rows.push(["GPS", `${photo.lat.toFixed(6)}, ${photo.lng.toFixed(6)}`]);
  if (photo.altitude_m !== null) {
    rows.push([
      "Altitude",
      `${Math.round(photo.altitude_m)} m${photo.altitude_accuracy_m !== null ? ` (±${Math.round(photo.altitude_accuracy_m)} m)` : ""}`,
    ]);
  }
  if (photo.speed_mps !== null) rows.push(["Speed", `${Math.round(photo.speed_mps * 3.6)} km/h`]);
  if (photo.ip_country) rows.push(["Internet from", countryName(photo.ip_country)]);
  if (photo.browser_id) rows.push(["Phone ID", photo.browser_id.slice(0, 8)]);
  if (photo.sha256) rows.push(["File fingerprint", photo.sha256.slice(0, 12)]);
  return (
    <details className="text-xs text-slate-600">
      <summary className="cursor-pointer font-semibold text-slate-500">Details</summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
