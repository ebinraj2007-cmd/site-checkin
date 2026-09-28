import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Alert } from "@/components/ui";
import { hasAnyUser } from "@/lib/auth";
import { RECOVERY_MIN_LENGTH, recoveryEnabled } from "@/lib/setup-code";
import { RecoverForm } from "./RecoverForm";

export const metadata: Metadata = { title: "Recover manager account" };

export default async function RecoverPage() {
  await connection();
  if (!(await hasAnyUser())) redirect("/setup");
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <div className="mb-6">
        <Link href="/login" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Log in
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Recover a manager account</h1>
        <p className="mt-2 text-sm text-slate-600">
          For a manager who forgot their PIN, is locked out, or lost their phone. Workers: ask your manager to reset your
          PIN instead. This logs the manager out everywhere else and turns off alerts on their other devices.
        </p>
      </div>
      {recoveryEnabled() ? (
        <RecoverForm />
      ) : (
        <Alert tone="amber">
          Recovery needs a setup code. Whoever put this app online can set a <strong>SETUP_CODE</strong> environment
          variable (at least {RECOVERY_MIN_LENGTH} random characters) in the hosting settings, redeploy, and open this page
          again.
        </Alert>
      )}
    </main>
  );
}
