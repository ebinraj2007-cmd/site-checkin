import { formatDistance, mapsLink } from "@/lib/geo";
import type { JobPhoto } from "@/lib/job-rules";
import { formatDateTime, formatDuration } from "@/lib/time";
import { Badge } from "./ui";

// A gap this size between the phone's shutter time and the server's receipt is worth showing.
const NOTABLE_GAP = 2 * 60_000;

// One proof photo with what the server recorded about it.
export function PhotoTile({
  photo,
  tz,
  radius,
  compact = false,
  label,
}: {
  photo: JobPhoto;
  tz: string;
  radius: number;
  compact?: boolean;
  label?: string;
}) {
  const src = `/api/files/${photo.file_key}`;
  const located = photo.lat !== null && photo.lng !== null;
  // Received minus taken (by the phone's clock): late sends, or a phone clock that's off.
  const gap = photo.device_time ? photo.created_at.getTime() - photo.device_time.getTime() : 0;
  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <a href={src} target="_blank" rel="noopener noreferrer" className="block bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
        <img
          src={src}
          alt={`${photo.kind} photo`}
          loading="lazy"
          className={`w-full object-contain ${compact ? "aspect-square object-cover" : "max-h-96"}`}
        />
      </a>
      {!compact && (
        <figcaption className="space-y-1 p-3 text-sm">
          <p className="font-semibold text-slate-800">
            {label && `${label} · `}
            {formatDateTime(photo.created_at, tz)}
            {photo.user_name && <span className="font-normal text-slate-500"> · by {photo.user_name}</span>}
          </p>
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
          {located && (
            <a
              href={mapsLink({ lat: photo.lat!, lng: photo.lng! })}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-semibold text-brand-700"
            >
              Where it was taken →
            </a>
          )}
        </figcaption>
      )}
    </figure>
  );
}
