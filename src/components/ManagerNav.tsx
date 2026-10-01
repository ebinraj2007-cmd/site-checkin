"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/m", label: "Today", exact: true },
  { href: "/m/jobs", label: "Jobs" },
  { href: "/m/review", label: "Review" },
  { href: "/m/workers", label: "Workers" },
  { href: "/m/settings", label: "Settings" },
  { href: "/w", label: "My jobs" },
];

// `reviewCount`: check-ins waiting for a manager's review, shown on the Review tab.
export function ManagerNav({ reviewCount = 0 }: { reviewCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3" aria-label="Main">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href) && !pathname.startsWith("/m/jobs/new");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold transition ${
              active ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
            {t.href === "/m/review" && reviewCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">{reviewCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
