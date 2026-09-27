import Link from "next/link";
import { logout } from "@/app/actions";
import { ManagerNav } from "@/components/ManagerNav";
import { buttonClass, LinkButton } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export default async function ManagerLayout({ children }: LayoutProps<"/m">) {
  const [me, settings] = await Promise.all([requireManager(), getSettings()]);
  return (
    <div className="min-h-dvh pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 pt-3 pb-1">
          <Link href="/m" className="min-w-0 truncate text-base font-bold tracking-tight text-slate-900">
            {settings.companyName}
          </Link>
          <div className="ml-auto flex items-center gap-1.5">
            <form action={logout}>
              <button className={buttonClass("ghost")} title={`Logged in as ${me.name}`}>
                Log out
              </button>
            </form>
            <LinkButton href="/m/jobs/new">+ New job</LinkButton>
          </div>
        </div>
        <ManagerNav />
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
    </div>
  );
}
