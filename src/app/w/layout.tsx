import Link from "next/link";
import { LogoutButton } from "@/components/LogoutButton";
import { Notice } from "@/components/Notice";
import { buttonClass } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { NOTICE_VERSION } from "@/lib/notice";
import { getSettings } from "@/lib/settings";
import { acceptNotice } from "./actions";

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
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-4">
        {/* Everyone reads what the app records before using it. */}
        {me.notice_version < NOTICE_VERSION ? <Notice company={settings.companyName} accept={acceptNotice} /> : children}
      </main>
    </div>
  );
}
