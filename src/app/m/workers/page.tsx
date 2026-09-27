import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageTitle } from "@/components/ui";
import { requireManager } from "@/lib/auth";
import { displayPhone } from "@/lib/phone";
import { listUsers } from "@/lib/users";
import { AddWorkerForm } from "./AddWorkerForm";

export const metadata: Metadata = { title: "Workers" };

export default async function WorkersPage() {
  const me = await requireManager();
  const users = await listUsers();
  return (
    <div className="space-y-6">
      <PageTitle title="Workers" subtitle="Everyone who can log in. Workers log in with their mobile number and PIN." />
      <Card>
        <h2 className="mb-3 text-base font-bold">Add a worker</h2>
        <AddWorkerForm />
      </Card>
      <Card className="divide-y divide-slate-100 p-0">
        {users.map((u) => (
          <Link key={u.id} href={`/m/workers/${u.id}`} className="flex items-center gap-3 p-3.5 hover:bg-slate-50">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-600">
              {u.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className={`truncate font-semibold ${u.active ? "" : "text-slate-400 line-through"}`}>
                {u.name}
                {u.id === me.id && <span className="ml-1 font-normal text-slate-500">(you)</span>}
              </p>
              <p className="truncate text-sm text-slate-500">
                {displayPhone(u.phone)} · {u.open_jobs} open job{u.open_jobs === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              {u.role === "manager" && <Badge tone="blue">Manager</Badge>}
              {!u.active ? (
                <Badge tone="gray">Inactive</Badge>
              ) : (
                <Badge tone={u.devices ? "green" : "amber"}>{u.devices ? "Alerts on" : "Alerts off"}</Badge>
              )}
            </div>
          </Link>
        ))}
      </Card>
    </div>
  );
}
