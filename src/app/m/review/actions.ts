"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireManager, type SessionUser } from "@/lib/auth";
import { query, queryOne, transaction } from "@/lib/db";
import { checkOnSite } from "@/lib/geo";
import { getJob, isUuid, newCustomerCode, newVisit, SKIP_STEP_LABEL, type JobPhoto, type JobSkip } from "@/lib/jobs";
import { notifyUsers } from "@/lib/push";

export type ReviewFormState = { error?: string; ok?: boolean; message?: string } | null;

const KIND = { arrival: "arrival photo", work: "work photo", leave: "leaving photo" } as const;

function readDecision(form: FormData) {
  const decision = form.get("decision");
  const note = String(form.get("note") ?? "").trim().slice(0, 300);
  if (decision === "approve") return { review: "approved" as const, note };
  if (decision === "reject") return { review: "rejected" as const, note };
  return null;
}

// Managers check in on jobs too. When another manager could look at it, nobody reviews
// their own check-in.
async function ownCheckin(me: SessionUser, workerId: string | null): Promise<string | null> {
  if (workerId !== me.id) return null;
  const other = await queryOne("SELECT 1 FROM users WHERE role = 'manager' AND active AND id <> $1", [me.id]);
  return other ? "Another manager has to review your own check-in." : null;
}

// Approve or reject a photo waiting for review. Approving can also move the job pin to
// where the photo was taken (for "the pin is in the wrong place"). Rejecting the arrival
// photo of a visit still under way ends that visit: the worker checks in again. Rejecting
// the leaving photo of the latest visit puts the job back on site for a new one.
export async function reviewPhoto(photoId: string, _prev: ReviewFormState, form: FormData): Promise<ReviewFormState> {
  const me = await requireManager();
  const decision = readDecision(form);
  if (!decision || !isUuid(photoId)) return { error: "Choose Approve or Reject." };
  const before = await queryOne<{ user_id: string | null }>("SELECT user_id FROM job_photos WHERE id = $1", [photoId]);
  const own = await ownCheckin(me, before?.user_id ?? null);
  if (own) return { error: own };
  const photo = await queryOne<JobPhoto>(
    `UPDATE job_photos SET review = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
      WHERE id = $1 AND review = 'pending' RETURNING *`,
    [photoId, decision.review, me.id, decision.note],
  );
  if (!photo) return { error: "This was reviewed already." };
  const job = await getJob(photo.job_id);
  if (!job) return { error: "This job no longer exists." };

  let message = decision.review === "approved" ? "Approved." : "Rejected.";
  let next = "";
  const checkin = photo.kind === "arrival" || photo.kind === "leave";
  if (decision.review === "approved" && checkin && form.get("move_pin") === "on" && photo.lat !== null && photo.lng !== null) {
    await movePin(job.id, { lat: photo.lat, lng: photo.lng }, job.radius_m);
    message = "Approved, and the job pin now marks where this photo was taken.";
  }
  if (decision.review === "rejected" && photo.kind === "arrival") {
    const restarted = await query(
      `UPDATE jobs j SET status = 'assigned', ${newVisit("$2")}, updated_at = now()
         FROM job_photos p
        WHERE p.id = $1 AND j.id = p.job_id AND j.status = 'arrived' AND p.created_at >= j.arrived_at
        RETURNING j.id`,
      [photo.id, newCustomerCode()],
    );
    if (restarted.length) {
      next = "Send a new arrival photo from the site.";
      message = `Rejected. ${job.worker_name ?? "The worker"} has to send a new arrival photo from the site.${
        job.require_customer_code ? " The job has a new customer code: send it to the customer again." : ""
      }`;
    }
  }
  if (decision.review === "rejected" && photo.kind === "leave") {
    const reopened = await query(
      `UPDATE jobs j SET status = 'arrived', left_at = NULL, completed_at = NULL, updated_at = now()
         FROM job_photos p
        WHERE p.id = $1 AND j.id = p.job_id AND j.status = 'completed' AND p.created_at >= j.arrived_at
        RETURNING j.id`,
      [photo.id],
    );
    if (reopened.length) {
      next = "Send a new leaving photo from the site.";
      message = `Rejected. The job is open again until ${job.worker_name ?? "the worker"} sends a new leaving photo from the site.`;
    }
  }

  if (photo.user_id) {
    const worker = photo.user_id;
    const why = decision.note ? ` · ${decision.note}` : "";
    if (decision.review === "rejected") {
      after(() =>
        notifyUsers([worker], {
          title: `Your ${KIND[photo.kind]} wasn't accepted`,
          body: `${job.title}${why}${next ? ` · ${next}` : ""}`,
          url: `/w/jobs/${job.id}`,
          tag: `job-${job.id}`,
        }),
      );
    } else if (photo.request_reason) {
      after(() =>
        notifyUsers([worker], {
          title: `Your ${KIND[photo.kind]} was approved`,
          body: `${job.title}${why}`,
          url: `/w/jobs/${job.id}`,
          tag: `job-${job.id}`,
        }),
      );
    }
  }
  revalidatePath("/m", "layout");
  return { ok: true, message };
}

// The pin was in the wrong place: move it, and re-measure the photos on record from it.
async function movePin(jobId: string, to: { lat: number; lng: number }, radius: number) {
  await transaction(async (q) => {
    await q.query("UPDATE jobs SET site_lat = $2, site_lng = $3, pin_from_photo = true, updated_at = now() WHERE id = $1", [
      jobId,
      to.lat,
      to.lng,
    ]);
    const photos = await q.query<{ id: string; lat: number; lng: number; accuracy_m: number | null }>(
      "SELECT id, lat, lng, accuracy_m FROM job_photos WHERE job_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL",
      [jobId],
    );
    for (const p of photos) {
      const check = checkOnSite({ ...to, radius }, { lat: p.lat, lng: p.lng, accuracy: p.accuracy_m ?? 0 });
      await q.query("UPDATE job_photos SET distance_m = $2, on_site = $3 WHERE id = $1", [p.id, check.distance, check.ok]);
    }
  });
}

// Approve or reject a customer step the worker skipped. A rejected skip makes the step
// needed again while that visit is under way (a code gets its tries back, since the
// manager may have sorted it out with the customer); afterwards it stays on record.
export async function reviewSkip(skipId: string, _prev: ReviewFormState, form: FormData): Promise<ReviewFormState> {
  const me = await requireManager();
  const decision = readDecision(form);
  if (!decision || !isUuid(skipId)) return { error: "Choose Approve or Reject." };
  const before = await queryOne<{ user_id: string | null }>("SELECT user_id FROM job_skips WHERE id = $1", [skipId]);
  const own = await ownCheckin(me, before?.user_id ?? null);
  if (own) return { error: own };
  const skip = await queryOne<JobSkip>(
    `UPDATE job_skips SET review = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
      WHERE id = $1 AND review = 'pending' RETURNING *`,
    [skipId, decision.review, me.id, decision.note],
  );
  if (!skip) return { error: "This was reviewed already." };
  const job = await getJob(skip.job_id);
  if (!job) return { error: "This job no longer exists." };
  const step = SKIP_STEP_LABEL[skip.step];
  const ongoing = job.status === "arrived" && !!job.arrived_at && skip.created_at.getTime() >= job.arrived_at.getTime();
  if (decision.review === "rejected" && ongoing && skip.step === "code") {
    await query("UPDATE jobs SET code_attempts = 0 WHERE id = $1 AND code_confirmed_at IS NULL", [job.id]);
  }
  if (decision.review === "rejected" && skip.user_id) {
    const worker = skip.user_id;
    after(() =>
      notifyUsers([worker], {
        title: `Skipping the ${step} wasn't accepted`,
        body: [job.title, decision.note, ongoing ? `Get the ${step} before you finish.` : null].filter(Boolean).join(" · "),
        url: `/w/jobs/${job.id}`,
        tag: `job-${job.id}`,
      }),
    );
  }
  revalidatePath("/m", "layout");
  return { ok: true, message: decision.review === "approved" ? "Approved." : "Rejected." };
}
