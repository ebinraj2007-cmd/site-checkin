import type { FormState } from "@/app/m/actions";
import { Alert, LinkButton, WhatsAppIcon } from "./ui";

// Shows a form's result; offers the WhatsApp message when the action produced one.
export function ActionResult({ state, whatsappLabel = "Send on WhatsApp" }: { state: FormState; whatsappLabel?: string }) {
  if (!state) return null;
  if (state.error) return <Alert tone="red">{state.error}</Alert>;
  return (
    <div className="space-y-2">
      {state.message && <Alert tone="green">{state.message}</Alert>}
      {state.whatsappUrl && (
        <LinkButton href={state.whatsappUrl} external variant="whatsapp">
          <WhatsAppIcon /> {whatsappLabel}
        </LinkButton>
      )}
    </div>
  );
}
