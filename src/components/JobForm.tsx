"use client";

import { useState } from "react";
import type { FormState } from "@/app/m/actions";
import type { LatLng } from "@/lib/geo";
import { MapPicker } from "./MapPicker";
import { SubmitButton } from "./SubmitButton";
import { useFormAction } from "./useFormAction";
import { Alert, Card, Field, inputClass } from "./ui";

export type WorkerOption = { id: string; name: string; role: string; alerts: boolean };

export type JobDefaults = {
  title: string;
  assignedTo: string;
  scheduledAt: string; // datetime-local value in the company timezone
  address: string;
  point: LatLng | null;
  radius: number;
  customerName: string;
  customerPhone: string;
  instructions: string;
  requireLeavePhoto: boolean;
  requireWorkPhotos: boolean;
  requireNotes: boolean;
  requireSignature: boolean;
};

const RADII = [50, 100, 150, 200, 300, 500, 1000];

export function JobForm({
  action,
  workers,
  defaults,
  fallbackCenter,
  timezone,
  submitLabel,
  workerLocked,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  workers: WorkerOption[];
  defaults: JobDefaults;
  fallbackCenter: LatLng | null;
  timezone: string;
  submitLabel: string;
  workerLocked?: string;
}) {
  const [state, onSubmit, pending] = useFormAction(action, null);
  const [radius, setRadius] = useState(defaults.radius);
  const [workerId, setWorkerId] = useState(defaults.assignedTo);
  const worker = workers.find((w) => w.id === workerId);
  const radii = RADII.includes(defaults.radius) ? RADII : [...RADII, defaults.radius].sort((a, b) => a - b);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="space-y-4">
        <Field label="Job title" htmlFor="title">
          <input
            id="title"
            name="title"
            required
            maxLength={120}
            defaultValue={defaults.title}
            placeholder="e.g. AC service – Villa 12"
            className={inputClass}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Worker"
            htmlFor="assigned_to"
            hint={
              workerLocked ??
              (worker
                ? worker.alerts
                  ? "Gets a phone notification when you save."
                  : "Hasn't turned on job alerts yet. Send the job on WhatsApp after saving."
                : undefined)
            }
          >
            <select
              id="assigned_to"
              name="assigned_to"
              required
              value={workerId}
              onChange={(e) => setWorkerId(e.target.value)}
              disabled={!!workerLocked}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                  {w.role === "manager" ? " (manager)" : ""}
                </option>
              ))}
            </select>
            {workerLocked && <input type="hidden" name="assigned_to" value={workerId} />}
          </Field>
          <Field label="Date & time" htmlFor="scheduled_at" hint={`Optional. Times are in ${timezone}.`}>
            <input
              id="scheduled_at"
              name="scheduled_at"
              type="datetime-local"
              defaultValue={defaults.scheduledAt}
              className={inputClass}
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-bold">Where</h2>
        <MapPicker
          defaultPoint={defaults.point}
          defaultAddress={defaults.address}
          fallbackCenter={fallbackCenter}
          radius={radius}
        />
        <Field
          label="Check-in distance"
          htmlFor="radius"
          hint="How close to the pin the worker must be to send the arrival and leaving photos."
        >
          <select
            id="radius"
            name="radius"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className={inputClass}
          >
            {radii.map((r) => (
              <option key={r} value={r}>
                Within {r >= 1000 ? `${r / 1000} km` : `${r} m`}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-bold">What the worker must send</h2>
        <div className="space-y-2">
          <Check name="" checked disabled label="Arrival photo" detail="Taken with the camera at the site, stamped with time and GPS." />
          <Check name="require_work_photos" defaultChecked={defaults.requireWorkPhotos} label="Work photos" detail="Before/after or finished-work photos." />
          <Check name="require_notes" defaultChecked={defaults.requireNotes} label="Notes" detail="A short report of what was done." />
          <Check name="require_signature" defaultChecked={defaults.requireSignature} label="Customer signature" detail="The customer signs on the worker's screen." />
          <Check name="require_leave_photo" defaultChecked={defaults.requireLeavePhoto} label="Leaving photo" detail="Taken at the site when leaving. Without it, the job has no time on site." />
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-base font-bold">Customer & instructions</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Customer name" htmlFor="customer_name">
            <input id="customer_name" name="customer_name" maxLength={120} defaultValue={defaults.customerName} className={inputClass} />
          </Field>
          <Field label="Customer phone" htmlFor="customer_phone">
            <input id="customer_phone" name="customer_phone" type="tel" maxLength={30} defaultValue={defaults.customerPhone} className={inputClass} />
          </Field>
        </div>
        <Field label="Instructions for the worker" htmlFor="instructions">
          <textarea
            id="instructions"
            name="instructions"
            rows={3}
            maxLength={2000}
            defaultValue={defaults.instructions}
            placeholder="Gate code, parts to bring, who to ask for…"
            className={inputClass}
          />
        </Field>
      </Card>

      {state?.error && <Alert tone="red">{state.error}</Alert>}
      <div className="sticky bottom-3 z-10">
        <SubmitButton pending={pending} size="lg" pendingText="Saving…" className="shadow-lg">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  );
}

function Check({
  name,
  label,
  detail,
  defaultChecked,
  checked,
  disabled,
}: {
  name: string;
  label: string;
  detail: string;
  defaultChecked?: boolean;
  checked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 rounded-xl border border-slate-200 p-3 ${disabled ? "bg-slate-50" : "cursor-pointer hover:bg-slate-50"}`}>
      <input
        type="checkbox"
        name={name || undefined}
        defaultChecked={defaultChecked}
        checked={checked}
        readOnly={checked !== undefined}
        disabled={disabled}
        className="mt-0.5 h-5 w-5 shrink-0 accent-brand-700"
      />
      <span>
        <span className="block text-sm font-semibold text-slate-800">
          {label}
          {disabled && <span className="ml-1.5 text-xs font-normal text-slate-500">always</span>}
        </span>
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
    </label>
  );
}
