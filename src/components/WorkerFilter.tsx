"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inputClass } from "./ui";

export function WorkerFilter({ workers }: { workers: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      aria-label="Filter by worker"
      value={params.get("worker") ?? ""}
      onChange={(e) => {
        const next = new URLSearchParams(params);
        if (e.target.value) next.set("worker", e.target.value);
        else next.delete("worker");
        router.push(`${pathname}?${next}`);
      }}
      className={`${inputClass} w-auto py-2 text-sm`}
    >
      <option value="">All workers</option>
      {workers.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
