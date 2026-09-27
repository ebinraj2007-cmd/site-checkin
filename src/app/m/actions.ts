"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { appUrl } from "@/lib/app-url";
import {
  endAllSessions,
  hashPin,
  isValidPin,
  randomPin,
  requireManager,
  verifyPin,
} from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { isValidLatLng } from "@/lib/geo";
import { getJob, type Job } from "@/lib/jobs";
import { inviteMessage } from "@/lib/messages";
import { normalizePhone, whatsappLink } from "@/lib/phone";
import { deleteAllSubscriptions, notifyUsers } from "@/lib/push";
import { getSettings, saveSettings, validTimezone } from "@/lib/settings";
import { formatDateTime, localInputToDate } from "@/lib/time";

export type FormState = {
  error?: string;
  ok?: boolean;
  message?: string;
  whatsappUrl?: string;
  pin?: string;
} | null;

const text = (form: FormData, key: string, max: number) => String(form.get(key) ?? "").trim().slice(0, max);

// ---------- Jobs ----------

type JobInput = {
  title: string;
  address: string;
  lat: number;
  lng: number;
  radius: number;
  scheduledAt: Date | null;
  assignedTo: string;
  customerName: string;
  customerPhone: string;
  instructions: string;
  requireLeavePhoto: boolean;
  requireWorkPhotos: boolean;
  requireNotes: boolean;
  requireSignature: boolean;
};

async function readJobForm(form: FormData): Promise<JobInput | { error: string }> {
  const settings = await getSettings();
  const title = text(form, "title", 120);
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  const radius = Math.round(Number(form.get("radius") || settings.defaultRadius));
  const when = text(form, "scheduled_at", 20);
  const assignedTo = text(form, "assigned_to", 40);
  const rawCustomerPhone = text(form, "customer_phone", 30);
  const customerPhone = rawCustomerPhone ? normalizePhone(rawCustomerPhone, settings.countryCode) : "";

  if (!title) return { error: "Give the job a title." };
  if (!form.get("lat") || !isValidLatLng(lat, lng)) return { error: "Set the job location on the map." };
  if (!(radius >= 20 && radius <= 5000)) return { error: "Check-in distance must be between 20 m and 5 km." };
  const scheduledAt = when ? localInputToDate(when, settings.timezone) : null;
  if (when && !scheduledAt) return { error: "The date and time look wrong." };
  const worker = assignedTo
    ? await queryOne("SELECT 1 FROM users WHERE id::text = $1 AND active", [assignedTo])
    : null;
  if (!worker) return { error: "Choose who does this job." };
  if (customerPhone === null) return { error: "The customer phone number looks wrong." };

  return {
    title,
    address: text(form, "address", 300),
    lat,
    lng,
    radius,
    scheduledAt,
    assignedTo,
    customerName: text(form, "customer_name", 120),
    customerPhone,
    instructions: text(form, "instructions", 2000),
    requireLeavePhoto: form.get("require_leave_photo") === "on",
    requireWorkPhotos: form.get("require_work_photos") === "on",
    requireNotes: form.get("require_notes") === "on",
    requireSignature: form.get("require_signature") === "on",
  };
}

function jobPush(job: Pick<Job, "id" | "title" | "address" | "scheduled_at">, title: string, tz: string) {
  const when = job.scheduled_at ? formatDateTime(job.scheduled_at, tz) : null;
  return {
    title,
    body: [job.title, when, job.address].filter(Boolean).join(" · "),
    url: `/w/jobs/${job.id}`,
    tag: `job-${job.id}`,
  };
}

export async function createJob(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireManager();
  const input = await readJobForm(form);
  if ("error" in input) return { error: input.error };
  const [job] = await query<Job>(
    `INSERT INTO jobs (title, address, site_lat, site_lng, radius_m, scheduled_at, assigned_to,
                       customer_name, customer_phone, instructions, require_leave_photo,
                       require_work_photos, require_notes, require_signature, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      input.title,
      input.address,
      input.lat,
      input.lng,
      input.radius,
      input.scheduledAt?.toISOString() ?? null,
      input.assignedTo,
      input.customerName,
      input.customerPhone,
      input.instructions,
      input.requireLeavePhoto,
      input.requireWorkPhotos,
      input.requireNotes,
      input.requireSignature,
      me.id,
    ],
  );
  const { timezone } = await getSettings();
  after(() => notifyUsers([input.assignedTo], jobPush(job, "New job", timezone)));
  redirect(`/m/jobs/${job.id}?created=1`);
}

export async function updateJob(jobId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  const before = await getJob(jobId);
  if (!before) return { error: "This job no longer exists." };
  const input = await readJobForm(form);
  if ("error" in input) return { error: input.error };
  const [job] = await query<Job>(
    `UPDATE jobs SET title = $2, address = $3, site_lat = $4, site_lng = $5, radius_m = $6,
            scheduled_at = $7, assigned_to = $8, customer_name = $9, customer_phone = $10,
            instructions = $11, require_leave_photo = $12, require_work_photos = $13,
            require_notes = $14, require_signature = $15, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [
      jobId,
      input.title,
      input.address,
      input.lat,
      input.lng,
      input.radius,
      input.scheduledAt?.toISOString() ?? null,
      input.assignedTo,
      input.customerName,
      input.customerPhone,
      input.instructions,
      input.requireLeavePhoto,
      input.requireWorkPhotos,
      input.requireNotes,
      input.requireSignature,
    ],
  );
  const open = job.status === "assigned" || job.status === "arrived";
  if (open) {
    const { timezone } = await getSettings();
    const reassigned = before.assigned_to !== job.assigned_to;
    const changed =
      before.scheduled_at?.getTime() !== job.scheduled_at?.getTime() ||
      before.address !== job.address ||
      before.site_lat !== job.site_lat ||
      before.site_lng !== job.site_lng;
    after(async () => {
      if (reassigned) {
        await notifyUsers([job.assigned_to!], jobPush(job, "New job", timezone));
        if (before.assigned_to) {
          await notifyUsers([before.assigned_to], {
            title: "Job moved to someone else",
            body: job.title,
            url: "/w",
          });
        }
      } else if (changed) {
        await notifyUsers([job.assigned_to!], jobPush(job, "Job updated", timezone));
      }
    });
  }
  redirect(`/m/jobs/${jobId}`);
}

export async function cancelJob(jobId: string) {
  await requireManager();
  const [job] = await query<Job>(
    `UPDATE jobs SET status = 'cancelled', updated_at = now()
      WHERE id = $1 AND status IN ('assigned', 'arrived') RETURNING *`,
    [jobId],
  );
  if (job?.assigned_to) {
    after(() => notifyUsers([job.assigned_to!], { title: "Job cancelled", body: job.title, url: "/w" }));
  }
  revalidatePath(`/m/jobs/${jobId}`);
}

// Cancelled → back to not started. Done → back on site, so the worker can add what's missing.
export async function reopenJob(jobId: string) {
  await requireManager();
  const [job] = await query<Job>(
    `UPDATE jobs
        SET status = CASE WHEN status = 'cancelled' THEN 'assigned' ELSE 'arrived' END,
            completed_at = NULL, left_at = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('cancelled', 'completed') RETURNING *`,
    [jobId],
  );
  if (job?.assigned_to) {
    const { timezone } = await getSettings();
    after(() => notifyUsers([job.assigned_to!], jobPush(job, "Job reopened", timezone)));
  }
  revalidatePath(`/m/jobs/${jobId}`);
}

// ---------- Workers ----------

export async function createWorker(_prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  const settings = await getSettings();
  const name = text(form, "name", 80);
  const phone = normalizePhone(text(form, "phone", 30), settings.countryCode);
  const role = form.get("role") === "manager" ? "manager" : "worker";
  const pin = text(form, "pin", 8) || randomPin();
  if (!name) return { error: "Enter the worker's name." };
  if (!phone) return { error: "Enter a valid mobile number." };
  if (!isValidPin(pin)) return { error: "The PIN must be 4 to 8 digits." };
  const taken = await queryOne("SELECT 1 FROM users WHERE phone = $1", [phone]);
  if (taken) return { error: "Someone with this phone number is already added." };
  await query("INSERT INTO users (name, phone, role, pin_hash) VALUES ($1, $2, $3, $4)", [
    name,
    phone,
    role,
    await hashPin(pin),
  ]);
  revalidatePath("/m/workers");
  const message = inviteMessage({ name, company: settings.companyName, baseUrl: await appUrl(), phone, pin });
  return { ok: true, message: `${name} added. PIN: ${pin}`, pin, whatsappUrl: whatsappLink(phone, message) };
}

export async function updateWorker(userId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireManager();
  const settings = await getSettings();
  const name = text(form, "name", 80);
  const phone = normalizePhone(text(form, "phone", 30), settings.countryCode);
  const role = form.get("role") === "manager" ? "manager" : "worker";
  const active = form.get("active") === "on";
  if (!name) return { error: "Enter a name." };
  if (!phone) return { error: "Enter a valid mobile number." };
  if (userId === me.id && (role !== "manager" || !active)) {
    return { error: "You can't remove your own manager access." };
  }
  const taken = await queryOne("SELECT 1 FROM users WHERE phone = $1 AND id <> $2", [phone, userId]);
  if (taken) return { error: "Someone else already uses this phone number." };
  await query("UPDATE users SET name = $2, phone = $3, role = $4, active = $5 WHERE id = $1", [
    userId,
    name,
    phone,
    role,
    active,
  ]);
  if (!active) {
    await endAllSessions(userId);
    await deleteAllSubscriptions(userId);
  }
  revalidatePath(`/m/workers/${userId}`);
  revalidatePath("/m/workers");
  return { ok: true, message: "Saved." };
}

export async function resetPin(userId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  const settings = await getSettings();
  const pin = text(form, "pin", 8) || randomPin();
  if (!isValidPin(pin)) return { error: "The PIN must be 4 to 8 digits." };
  const user = await queryOne<{ name: string; phone: string }>(
    "UPDATE users SET pin_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING name, phone",
    [userId, await hashPin(pin)],
  );
  if (!user) return { error: "Worker not found." };
  await endAllSessions(userId); // a lost phone stays logged out
  const message = inviteMessage({
    name: user.name,
    company: settings.companyName,
    baseUrl: await appUrl(),
    phone: user.phone,
    pin,
  });
  return {
    ok: true,
    message: `New PIN: ${pin}. ${user.name} is logged out everywhere until they use it.`,
    pin,
    whatsappUrl: whatsappLink(user.phone, message),
  };
}

// ---------- Settings ----------

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireManager();
  const companyName = text(form, "companyName", 80);
  const countryCode = text(form, "countryCode", 6).replace(/\D/g, "");
  const timezone = validTimezone(text(form, "timezone", 64));
  const defaultRadius = Math.round(Number(form.get("defaultRadius")));
  if (!companyName) return { error: "Enter the company name." };
  if (!timezone) return { error: "Choose a valid timezone." };
  if (!(defaultRadius >= 20 && defaultRadius <= 5000)) {
    return { error: "Check-in distance must be between 20 m and 5 km." };
  }
  await saveSettings({ companyName, countryCode, timezone, defaultRadius });
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

export async function changeMyPin(_prev: FormState, form: FormData): Promise<FormState> {
  const me = await requireManager();
  const current = text(form, "current", 8);
  const pin = text(form, "pin", 8);
  const pin2 = text(form, "pin2", 8);
  const row = await queryOne<{ pin_hash: string }>("SELECT pin_hash FROM users WHERE id = $1", [me.id]);
  if (!row || !(await verifyPin(current, row.pin_hash))) return { error: "Your current PIN is wrong." };
  if (!isValidPin(pin)) return { error: "The new PIN must be 4 to 8 digits." };
  if (pin !== pin2) return { error: "The new PINs don't match." };
  await query("UPDATE users SET pin_hash = $2 WHERE id = $1", [me.id, await hashPin(pin)]);
  return { ok: true, message: "PIN changed." };
}
