import type { Metadata } from "next";
import { CopyButton } from "@/components/CopyButton";
import { PasskeySetup } from "@/components/PasskeySetup";
import { PushSetup } from "@/components/PushSetup";
import { Card, PageTitle } from "@/components/ui";
import { appUrl } from "@/lib/app-url";
import { requireManager } from "@/lib/auth";
import { listPasskeys } from "@/lib/passkeys";
import { getSettings, passkeysRequired } from "@/lib/settings";
import { storageKind } from "@/lib/storage";
import { ChangePinForm, SecurityForm, SettingsForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await requireManager();
  const [settings, baseUrl, required, passkeys] = await Promise.all([
    getSettings(),
    appUrl(),
    passkeysRequired(),
    listPasskeys(me.id),
  ]);
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
      <Card className="space-y-3">
        <h2 className="text-base font-bold">Check-in security</h2>
        <p className="text-sm text-slate-600">
          Every photo is checked automatically: the same or a look-alike photo sent again, a GPS point copied from the job
          pin, travel faster than a car can go, one phone used for two people, and more. Check-ins with warning signs, and
          ones workers send for approval, wait in{" "}
          <a href="/m/review" className="font-semibold text-brand-700 underline">
            Review
          </a>{" "}
          and don&apos;t count until you approve them. Per job you can also ask for a selfie and a code from the customer.
        </p>
        <SecurityForm requirePasskeys={required} />
      </Card>
      <Card>
        <h2 className="mb-3 text-base font-bold">My PIN</h2>
        <ChangePinForm />
      </Card>
      <Card>
        <h2 className="mb-3 text-base font-bold">My fingerprint or face login</h2>
        <PasskeySetup count={passkeys.length} required={false} />
      </Card>
      <p className="px-1 text-xs text-slate-500">
        Photos are stored in {storageKind() === "supabase" ? "Supabase Storage (private bucket)" : "the app database"}.
      </p>
    </div>
  );
}
