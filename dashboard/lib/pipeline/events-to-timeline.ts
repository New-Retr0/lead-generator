import { isLeadFinishedStage, canonicalStageId } from "@/lib/pipeline/stages";
import type { JobEvent, RunTimeline, RunTimelineLead, RunTimelineStage } from "@/lib/types";

/**
 * Build Lead Activity timeline from the same live JobEvent stream the DAG uses.
 * Avoids drifting against a separately polled `detail.timeline`.
 */
export function jobEventsToRunTimeline(
  events: JobEvent[],
  liveNames?: Record<string, string>,
): RunTimeline {
  const runEvents: RunTimelineStage[] = [];
  const leadMap = new Map<string, RunTimelineLead>();

  for (const evt of events) {
    const placeId =
      typeof evt.place_id === "string" && evt.place_id.trim()
        ? evt.place_id
        : null;
    const stageRaw =
      (typeof evt.stage === "string" && evt.stage) ||
      (typeof evt.event === "string" ? evt.event : "");
    const stage = canonicalStageId(stageRaw) || stageRaw || "unknown";
    const createdAt =
      typeof evt.ts === "string" && evt.ts ? evt.ts : new Date(0).toISOString();
    const credits =
      typeof evt.credits === "number" && Number.isFinite(evt.credits)
        ? evt.credits
        : 0;
    const ran = evt.event !== "verification_rejected" && evt.event !== "lead_failed";

    const stageRow: RunTimelineStage = {
      stage,
      ran,
      reason: typeof evt.reason === "string" ? evt.reason : null,
      credits_est: credits,
      created_at: createdAt,
    };

    if (!placeId) {
      runEvents.push(stageRow);
      continue;
    }

    let lead = leadMap.get(placeId);
    if (!lead) {
      const business =
        (typeof evt.business === "string" && evt.business) ||
        liveNames?.[placeId] ||
        null;
      lead = {
        place_id: placeId,
        business_name: business,
        category_key: typeof evt.category === "string" ? evt.category : null,
        verification_level:
          typeof evt.verification_level === "string" ? evt.verification_level : null,
        lead_score: typeof evt.score === "number" ? evt.score : null,
        creditsEst: 0,
        done: false,
        stages: [],
      };
      leadMap.set(placeId, lead);
    } else {
      if (!lead.business_name && typeof evt.business === "string" && evt.business) {
        lead.business_name = evt.business;
      }
      if (
        !lead.verification_level &&
        typeof evt.verification_level === "string" &&
        evt.verification_level
      ) {
        lead.verification_level = evt.verification_level;
      }
      if (lead.lead_score == null && typeof evt.score === "number") {
        lead.lead_score = evt.score;
      }
    }

    lead.stages.push(stageRow);
    lead.creditsEst += credits;
    if (
      isLeadFinishedStage(stage) ||
      isLeadFinishedStage(evt.event) ||
      evt.event === "lead_done" ||
      evt.event === "lead_failed" ||
      evt.event === "verification_rejected"
    ) {
      lead.done = true;
    }
  }

  return {
    runEvents,
    leads: [...leadMap.values()],
  };
}
