import { getSql } from "./pg";
import { CRM_STATUSES, type CrmStatus } from "./types";

export function isCrmStatus(value: unknown): value is CrmStatus {
  return typeof value === "string" && (CRM_STATUSES as readonly string[]).includes(value);
}

export async function updateSalesFeedback(
  placeId: string,
  fields: { status?: CrmStatus; feedbackNotes?: string; addressed?: boolean },
): Promise<void> {
  const sql = getSql();

  const existingRows = await sql`
    SELECT addressed, feedback_notes, sales_ready, status, assigned_to
    FROM sales_feedback
    WHERE place_id = ${placeId}
  `;
  const existing = existingRows[0] as
    | {
        addressed: boolean;
        feedback_notes: string | null;
        sales_ready: boolean | null;
        status: string | null;
        assigned_to: string | null;
      }
    | undefined;

  const addressed =
    fields.addressed !== undefined ? fields.addressed : (existing?.addressed ?? false);
  const notes =
    fields.feedbackNotes !== undefined
      ? fields.feedbackNotes
      : (existing?.feedback_notes ?? "");
  const status = fields.status ?? existing?.status ?? "New";
  const now = new Date().toISOString();

  await sql`
    INSERT INTO sales_feedback (
      place_id, addressed, feedback_notes, sales_ready, status, assigned_to, updated_at
    )
    VALUES (
      ${placeId},
      ${addressed},
      ${notes},
      ${existing?.sales_ready ?? null},
      ${status},
      ${existing?.assigned_to ?? null},
      ${now}
    )
    ON CONFLICT (place_id) DO UPDATE SET
      addressed = EXCLUDED.addressed,
      feedback_notes = EXCLUDED.feedback_notes,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at
  `;
}
