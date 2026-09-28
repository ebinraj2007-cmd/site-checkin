import { Card, LinkButton } from "@/components/ui";

// A job that was moved to someone else (or never was this worker's).
export default function WorkerNotFound() {
  return (
    <Card className="space-y-3 text-center">
      <h1 className="text-lg font-bold">This job isn&apos;t yours anymore</h1>
      <p className="text-sm text-slate-600">It may have been given to someone else. Your jobs are on the My jobs page.</p>
      <LinkButton href="/w" className="w-full">
        My jobs
      </LinkButton>
    </Card>
  );
}
