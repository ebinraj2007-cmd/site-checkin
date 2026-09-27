import Link from "next/link";
import { logout } from "@/app/actions";
import { buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export default async function WorkerLayout({ children }: LayoutProps<"/w">) {
  const [me, settings] = await Promise.all([requireUser(), getSettings()]);
  return (
    <div className="min-h-dvh pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-3">
          <Link href="/w" className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight">{settings.companyName}</p>
            <p className="truncate text-xs text-slate-500">{me.name}</p>
          </Link>
          {me.role === "manager" && (
            <Link href="/m" className={buttonClass("secondary")}>
              Manager
            </Link>
          )}
          <form action={logout}>
            <button className={buttonClass("ghost")}>Log out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-4">{children}</main>
    </div>
  );
}
