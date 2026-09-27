import { formatDistance, mapsLink } from "@/lib/geo";
import type { JobPhoto } from "@/lib/job-rules";
import { formatDateTime } from "@/lib/time";
import { Badge } from "./ui";

// One proof photo with what the server recorded about it.
export function PhotoTile({
  photo,
  tz,
  radius,
  compact = false,
}: {
  photo: JobPhoto;
  tz: string;
  radius: number;
  compact?: boolean;
}) {
  const src = `/api/files/${photo.file_key}`;
  const located = photo.lat !== null && photo.lng !== null;
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
          <p className="font-semibold text-slate-800">{formatDateTime(photo.created_at, tz)}</p>
          <div className="flex flex-wrap gap-1.5">
            {photo.distance_m !== null && (
              <Badge tone={photo.on_site ? "green" : "red"}>
                {formatDistance(photo.distance_m)} from site{photo.on_site ? "" : ` (limit ${formatDistance(radius)})`}
              </Badge>
            )}
            {photo.accuracy_m !== null && <Badge tone="slate">GPS ±{Math.round(photo.accuracy_m)} m</Badge>}
            {!located && <Badge tone="amber">No GPS</Badge>}
            {!photo.live_camera && <Badge tone="amber">Not live camera</Badge>}
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
