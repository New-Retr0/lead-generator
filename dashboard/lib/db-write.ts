import Database from "better-sqlite3";
import { existsSync } from "fs";
import { dbPath } from "./paths";
import { CRM_STATUSES, type CrmStatus } from "./types";

let _writeDb: Database.Database | null = null;

function getWriteDb(): Database.Database {
  const resolved = dbPath();
  if (!existsSync(resolved)) {
    throw new Error(`Database not found at ${resolved}. Run pallares-leads first.`);
  }
  if (!_writeDb) {
    _writeDb = new Database(resolved);
    _writeDb.pragma("busy_timeout = 60000");
    _writeDb.pragma("journal_mode = WAL");
  }
  return _writeDb;
}

export function isCrmStatus(value: unknown): value is CrmStatus {
  return typeof value === "string" && (CRM_STATUSES as readonly string[]).includes(value);
}

export function updateSalesFeedback(
  placeId: string,
  fields: { status?: CrmStatus; feedbackNotes?: string; addressed?: boolean },
): void {
  const db = getWriteDb();
  const existing = db
    .prepare(
      "SELECT addressed, feedback_notes, sales_ready, status, assigned_to FROM sales_feedback WHERE place_id = ?",
    )
    .get(placeId) as
    | {
        addressed: number;
        feedback_notes: string | null;
        sales_ready: number | null;
        status: string | null;
        assigned_to: string | null;
      }
    | undefined;

  const addressed =
    fields.addressed !== undefined ? (fields.addressed ? 1 : 0) : (existing?.addressed ?? 0);
  const notes =
    fields.feedbackNotes !== undefined
      ? fields.feedbackNotes
      : (existing?.feedback_notes ?? "");
  const status = fields.status ?? existing?.status ?? "New";
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO sales_feedback (place_id, addressed, feedback_notes, sales_ready, status, assigned_to, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(place_id) DO UPDATE SET
       addressed = excluded.addressed,
       feedback_notes = excluded.feedback_notes,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    placeId,
    addressed,
    notes,
    existing?.sales_ready ?? null,
    status,
    existing?.assigned_to ?? null,
    now,
  );
}
