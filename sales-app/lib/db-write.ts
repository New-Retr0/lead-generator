import { createClient } from "@/lib/supabase/server";
import { CRM_STATUSES, type CrmStatus } from "./types";

export function isCrmStatus(value: unknown): value is CrmStatus {
  return typeof value === "string" && (CRM_STATUSES as readonly string[]).includes(value);
}

export async function updateSalesFeedback(
  placeId: string,
  fields: { status?: CrmStatus; feedbackNotes?: string; addressed?: boolean },
): Promise<void> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (fields.status !== undefined) patch.status = fields.status;
  if (fields.feedbackNotes !== undefined) patch.feedback_notes = fields.feedbackNotes;
  if (fields.addressed !== undefined) patch.addressed = fields.addressed;

  const { error } = await supabase
    .from("sales_feedback")
    .update(patch)
    .eq("place_id", placeId);
  if (error) throw new Error(error.message);
}
