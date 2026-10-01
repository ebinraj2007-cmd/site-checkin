import { noticeItems } from "@/lib/notice";
import { SubmitButton } from "./SubmitButton";
import { Card } from "./ui";

// What the app records, in plain words. With `accept`, it ends with an "I understand" button.
export function Notice({ company, accept }: { company: string; accept?: () => Promise<void> }) {
  const notice = noticeItems(company);
  return (
    <Card className="space-y-3">
      <h1 className="text-lg font-bold">{notice.title}</h1>
      <p className="text-sm text-slate-600">When you use this app for {company}, it records:</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-800">
        {notice.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">{notice.who}</p>
      <p className="text-sm text-slate-600">{notice.keep}</p>
      {accept && (
        <form action={accept}>
          <SubmitButton size="lg" pendingText="Saving…">
            I understand
          </SubmitButton>
        </form>
      )}
    </Card>
  );
}
