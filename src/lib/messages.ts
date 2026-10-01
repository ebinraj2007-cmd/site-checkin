import { directionsLink } from "./geo";
import { displayPhone } from "./phone";
import { formatWhen } from "./time";

// Text for the "Send on WhatsApp" buttons. Plain text: WhatsApp renders *bold* itself.

type JobForMessage = {
  id: string;
  title: string;
  address: string;
  scheduled_at: Date | null;
  site_lat: number;
  site_lng: number;
  customer_name: string;
  customer_phone: string;
  instructions: string;
};

export function jobMessage(job: JobForMessage, baseUrl: string, tz: string, workerName?: string | null): string {
  const lines = [
    workerName ? `Hi ${workerName.split(" ")[0]}, you have a new job.` : "New job.",
    "",
    `*${job.title}*`,
  ];
  if (job.scheduled_at) lines.push(`When: ${formatWhen(job.scheduled_at, tz)}`);
  if (job.address) lines.push(`Where: ${job.address}`);
  lines.push(`Directions: ${directionsLink({ lat: job.site_lat, lng: job.site_lng })}`);
  if (job.customer_name || job.customer_phone) {
    lines.push(`Customer: ${[job.customer_name, displayPhone(job.customer_phone)].filter(Boolean).join(", ")}`);
  }
  if (job.instructions) lines.push("", job.instructions);
  lines.push("", "When you reach the site, open the job and send your arrival photo:", `${baseUrl}/w/jobs/${job.id}`);
  return lines.join("\n");
}

export function inviteMessage(opts: {
  name: string;
  company: string;
  baseUrl: string;
  phone: string;
  pin: string;
}): string {
  return [
    `Hi ${opts.name.split(" ")[0]}, this is your login for ${opts.company}.`,
    "",
    `Open: ${opts.baseUrl}/login`,
    `Phone: ${displayPhone(opts.phone)}`,
    `PIN: ${opts.pin}`,
    "",
    "Add it to your home screen and tap “Turn on job alerts” so new jobs reach you.",
  ].join("\n");
}

// Sent by the manager to the customer. The customer gives the code to the worker in person
// when the work is done, which shows the worker was really there; the worker never sees it.
export function customerCodeMessage(
  job: { title: string; scheduled_at: Date | null; customer_name: string },
  code: string,
  company: string,
  tz: string,
): string {
  return [
    `Hello${job.customer_name ? ` ${job.customer_name.split(" ")[0]}` : ""}, this is ${company}.`,
    "",
    `Our technician is coming for: *${job.title}*${job.scheduled_at ? ` (${formatWhen(job.scheduled_at, tz)})` : ""}.`,
    `When the work is done, please give them this code: *${code}*`,
    "",
    "It confirms they were with you. Only give it to them in person.",
  ].join("\n");
}
