import "server-only";
import { query, queryOne } from "./db";
import { isUuid } from "./job-rules";

export type UserRow = {
  id: string;
  name: string;
  phone: string;
  role: "manager" | "worker";
  active: boolean;
  created_at: Date;
  devices: number; // phones with job alerts turned on
  open_jobs: number;
};

const USER_SELECT = `
  SELECT u.id, u.name, u.phone, u.role, u.active, u.created_at,
         (SELECT count(*)::int FROM push_subscriptions s WHERE s.user_id = u.id) AS devices,
         (SELECT count(*)::int FROM jobs j WHERE j.assigned_to = u.id AND j.status IN ('assigned', 'arrived')) AS open_jobs
    FROM users u`;

export async function listUsers(): Promise<UserRow[]> {
  return query<UserRow>(`${USER_SELECT} ORDER BY u.active DESC, u.role DESC, lower(u.name)`);
}

export async function getUserRow(id: string): Promise<UserRow | null> {
  if (!isUuid(id)) return null;
  return queryOne<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
}

export async function workerOptions() {
  const users = await listUsers();
  return users
    .filter((u) => u.active)
    .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "worker" ? -1 : 1))
    .map((u) => ({ id: u.id, name: u.name, role: u.role, alerts: u.devices > 0 }));
}
