import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hasAnyUser } from "@/lib/auth";
import { setupCode } from "@/lib/setup-code";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage() {
  await connection();
  if (await hasAnyUser()) redirect("/login");
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="mb-6">
        <p className="text-sm font-semibold text-brand-700">First-time setup</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Set up your check-in app</h1>
        <p className="mt-2 text-sm text-slate-600">
          You&apos;ll be the manager. After this you can add your workers and send them jobs.
        </p>
      </div>
      <SetupForm needsCode={!!setupCode()} />
    </main>
  );
}
