import { getSql } from "./pg";
import {
  CRM_STATUSES,
  OUTCOME_REASONS,
  OUTCOME_VALUES,
  TOUCH_RESULTS,
  TOUCH_TYPES,
  type CrmStatus,
  type LeadOutcomeInput,
  type LeadTouchInput,
  type OutcomeReason,
  type TouchResult,
  type TouchType,
} from "./types";

export function isFeedbackStatus(value: unknown): value is CrmStatus {
  return typeof value === "string" && (CRM_STATUSES as readonly string[]).includes(value);
}

const OUTCOME_TO_CRM: Record<string, CrmStatus> = {
  won: "Won",
  lost: "Lost",
  bad_data: "Bad Data",
  unqualified: "Lost",
  no_response: "Lost",
};

function isOutcomeValue(value: unknown): value is LeadOutcomeInput["outcome"] {
  return typeof value === "string" && (OUTCOME_VALUES as readonly string[]).includes(value);
}

function isOutcomeReason(value: unknown): value is OutcomeReason {
  return typeof value === "string" && (OUTCOME_REASONS as readonly string[]).includes(value);
}

function isTouchType(value: unknown): value is TouchType {
  return typeof value === "string" && (TOUCH_TYPES as readonly string[]).includes(value);
}

function isTouchResult(value: unknown): value is TouchResult {
  return typeof value === "string" && (TOUCH_RESULTS as readonly string[]).includes(value);
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

export async function upsertLeadOutcome(
  placeId: string,
  input: LeadOutcomeInput,
): Promise<void> {
  if (!isOutcomeValue(input.outcome)) {
    throw new Error(`Invalid outcome: ${String(input.outcome)}`);
  }
  if (input.outcome_reason != null && !isOutcomeReason(input.outcome_reason)) {
    throw new Error(`Invalid outcome_reason: ${String(input.outcome_reason)}`);
  }
  if (
    input.quality_rating != null &&
    (!Number.isInteger(input.quality_rating) ||
      input.quality_rating < 1 ||
      input.quality_rating > 5)
  ) {
    throw new Error("quality_rating must be an integer from 1 to 5");
  }
  if (
    input.deal_value_usd != null &&
    (!Number.isFinite(input.deal_value_usd) || input.deal_value_usd < 0)
  ) {
    throw new Error("deal_value_usd must be a non-negative number");
  }
  const crmStatus = OUTCOME_TO_CRM[input.outcome];
  const now = new Date().toISOString();
  const sql = getSql();
  const dataFlags = input.data_flags ?? {};
  await sql`
    INSERT INTO lead_outcomes (
      place_id, outcome, outcome_reason, deal_value_usd, quality_rating,
      data_flags, source, notes, decided_at, updated_at
    )
    VALUES (
      ${placeId},
      ${input.outcome},
      ${input.outcome_reason ?? null},
      ${input.deal_value_usd ?? null},
      ${input.quality_rating ?? null},
      ${sql.json(dataFlags)},
      'dashboard',
      ${input.notes ?? null},
      ${now},
      ${now}
    )
    ON CONFLICT (place_id) DO UPDATE SET
      outcome = EXCLUDED.outcome,
      outcome_reason = EXCLUDED.outcome_reason,
      deal_value_usd = EXCLUDED.deal_value_usd,
      quality_rating = EXCLUDED.quality_rating,
      data_flags = EXCLUDED.data_flags,
      source = 'dashboard',
      notes = EXCLUDED.notes,
      decided_at = EXCLUDED.decided_at,
      updated_at = EXCLUDED.updated_at
  `;
  await updateSalesFeedback(placeId, { status: crmStatus, feedbackNotes: input.notes ?? undefined });
}

export async function insertLeadTouch(placeId: string, input: LeadTouchInput): Promise<void> {
  if (!isTouchType(input.touch_type)) {
    throw new Error(`Invalid touch_type: ${String(input.touch_type)}`);
  }
  if (input.result != null && !isTouchResult(input.result)) {
    throw new Error(`Invalid touch result: ${String(input.result)}`);
  }
  if (
    input.duration_seconds != null &&
    (!Number.isInteger(input.duration_seconds) || input.duration_seconds < 0)
  ) {
    throw new Error("duration_seconds must be a non-negative integer");
  }
  const sql = getSql();
  const occurredAt = input.occurred_at ?? new Date().toISOString();
  await sql`
    INSERT INTO lead_touches (
      place_id, touch_type, result, contact_name, contact_phone,
      duration_seconds, source, notes, occurred_at
    )
    VALUES (
      ${placeId},
      ${input.touch_type},
      ${input.result ?? null},
      ${input.contact_name ?? null},
      ${input.contact_phone ?? null},
      ${input.duration_seconds ?? null},
      'dashboard',
      ${input.notes ?? null},
      ${occurredAt}
    )
  `;
}
