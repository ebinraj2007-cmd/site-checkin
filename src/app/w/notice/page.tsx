import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "What this app records" };

export default async function NoticePage() {
  await requireUser();
  const { companyName } = await getSettings();
  return (
    <div className="space-y-3">
      <Link href="/w" className="text-sm font-semibold text-slate-500">
        ← My jobs
      </Link>
      <Notice company={companyName} />
    </div>
  );
}
