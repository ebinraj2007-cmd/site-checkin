"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { NOTICE_VERSION } from "@/lib/notice";

// The person has read what the app records (see notice.ts).
export async function acceptNotice() {
  const me = await requireUser();
  await query("UPDATE users SET notice_version = $2, notice_accepted_at = now() WHERE id = $1", [me.id, NOTICE_VERSION]);
  revalidatePath("/w", "layout");
}
