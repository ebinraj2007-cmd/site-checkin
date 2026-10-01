import Link from "next/link";
import { FlashProvider } from "@/components/Flash";
import { ManagerNav } from "@/components/ManagerNav";
import { LogoutButton } from "@/components/LogoutButton";
import { LinkButton } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { reviewCount } from "@/lib/review";
import { getSettings } from "@/lib/settings";

export default async function ManagerLayout({ children }: LayoutProps<"/m">) {
  const me = await requireManager();
  const [settings, toReview] = await Promise.all([getSettings(), reviewCount()]);
  return (
    <div className="min-h-dvh pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 pt-3 pb-1">
          <Link href="/m" className="min-w-0 truncate text-base font-bold tracking-tight text-slate-900">
            {settings.companyName}
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="hidden text-sm text-slate-500 md:inline">{me.name}</span>
            <LogoutButton />
            <LinkButton href="/m/jobs/new">+ New job</LinkButton>
          </div>
        </div>
        <ManagerNav reviewCount={toReview} />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">
        <FlashProvider>{children}</FlashProvider>
      </main>
    </div>
  );
}
