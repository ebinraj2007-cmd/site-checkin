import type { Metadata } from "next";
import { CopyButton } from "@/components/CopyButton";
import { PushSetup } from "@/components/PushSetup";
import { Card, PageTitle } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import { requireManager } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { storageKind } from "@/lib/storage";
import { ChangePinForm, SettingsForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireManager();
  const [settings, baseUrl] = await Promise.all([getSettings(), appUrl()]);
  const loginUrl = `${baseUrl}/login`;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle title="Settings" />
      <Card>
        <h2 className="mb-3 text-base font-bold">Job alerts on this device</h2>
        <PushSetup />
      </Card>
      <Card>
        <h2 className="mb-1 text-base font-bold">App link for your team</h2>
        <p className="mb-3 text-sm text-slate-600">Workers open this on their phone and log in with their number and PIN.</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-3 py-2 text-sm">{loginUrl}</code>
          <CopyButton text={loginUrl} />
        </div>
      </Card>
      <Card>
        <h2 className="mb-3 text-base font-bold">Company</h2>
        <SettingsForm values={settings} />
      </Card>
      <Card>
        <h2 className="mb-3 text-base font-bold">My PIN</h2>
        <ChangePinForm />
      </Card>
      <p className="px-1 text-xs text-slate-500">
        Photos are stored in {storageKind() === "supabase" ? "Supabase Storage (private bucket)" : "the app database"}.
      </p>
    </div>
  );
}
