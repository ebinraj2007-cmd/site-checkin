import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSessionUser, hasAnyUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage() {
  await connection();
  if (!(await hasAnyUser())) redirect("/setup");
  if (await getSessionUser()) redirect("/");
  const { companyName } = await getSettings();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-700 text-white shadow-sm">
          <PinIcon />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{companyName}</h1>
        <p className="mt-1 text-sm text-slate-500">Log in with your phone number and PIN</p>
      </div>
      <LoginForm />
      <p className="mt-6 text-center text-xs text-slate-500">
        Forgot your PIN? Ask your manager to reset it.
        <br />
        Manager and can&apos;t get in?{" "}
        <Link href="/recover" className="font-semibold text-slate-700 underline">
          Use the setup code
        </Link>
      </p>
    </main>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M12 21s-7-5.5-7-11a7 7 0 1 1 14 0c0 5.5-7 11-7 11Z" />
      <path d="m9.5 10 1.8 1.8L15 8" />
    </svg>
  );
}
