import { NextRequest, NextResponse } from "next/server";
import {
  insertLeadTouch,
  isCrmStatus,
  updateSalesFeedback,
  upsertLeadOutcome,
} from "@/lib/db-write";
import { getLeadDetail, getLeadOutcome, listLeadTouches } from "@/lib/db";
import type { LeadOutcomeInput, LeadTouchInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ placeId: string }> },
) {
  try {
    const { placeId } = await params;
    const lead = await getLeadDetail(decodeURIComponent(placeId));
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    const [outcome, touches] = await Promise.all([
      getLeadOutcome(lead.place_id),
      listLeadTouches(lead.place_id),
    ]);
    return NextResponse.json({ lead, outcome, touches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load lead";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ placeId: string }> },
) {
  try {
    const { placeId } = await params;
    const id = decodeURIComponent(placeId);
    const body = (await req.json()) as {
      status?: unknown;
      feedbackNotes?: unknown;
      addressed?: unknown;
      outcome?: LeadOutcomeInput;
      touch?: LeadTouchInput;
    };
    const fields: Parameters<typeof updateSalesFeedback>[1] = {};
    if (body.status !== undefined) {
      if (!isCrmStatus(body.status)) {
        return NextResponse.json(
          { error: `Invalid status: ${String(body.status)}` },
          { status: 400 },
        );
      }
      fields.status = body.status;
    }
    if (typeof body.feedbackNotes === "string") fields.feedbackNotes = body.feedbackNotes;
    if (typeof body.addressed === "boolean") fields.addressed = body.addressed;

    if (body.outcome) {
      await upsertLeadOutcome(id, body.outcome);
    }
    if (Object.keys(fields).length > 0) {
      await updateSalesFeedback(id, fields);
    }

    if (body.touch) {
      await insertLeadTouch(id, body.touch);
    }

    if (!body.outcome && !body.touch && Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No valid fields" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to update lead";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
