import {
  appendJobLog,
  createSyntheticJob,
  finishSyntheticJob,
  registerSyntheticCancel,
} from "./jobs";
import type { JobRecord, JobStatus } from "./types";

/**
 * Scripted fake runs that drive the full appendLog → SSE → UI path with zero
 * API keys. Dev-only (the /api/jobs/mock route is guarded to non-production).
 */

export const MOCK_SCENARIOS = ["happy", "reject-heavy", "fail-fast", "doctor"] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === "string" && (MOCK_SCENARIOS as readonly string[]).includes(value);
}

type Step = { line: string; delayMs?: number };
type Script = {
  kind: JobRecord["kind"];
  command: string;
  status: JobStatus;
  exitCode: number;
  steps: Step[];
};

function evt(event: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ t: "evt", ts: new Date().toISOString(), event, ...fields });
}

const MOCK_BUSINESSES = [
  { place_id: "places/mock-plaza-01", business: "Sierra Vista Plaza" },
  { place_id: "places/mock-office-02", business: "Kern River Office Park" },
  { place_id: "places/mock-retail-03", business: "Blossom Trail Shopping Center" },
];

function leadSteps(
  runId: string,
  lead: (typeof MOCK_BUSINESSES)[number],
  opts: { rejections?: number; score?: number; level?: string } = {},
): Step[] {
  const { rejections = 0, score = 78, level = "verified" } = opts;
  const base = { run_id: runId, place_id: lead.place_id, business: lead.business };
  const steps: Step[] = [
    { line: evt("lead_started", base) },
    { line: evt("map", { ...base, stage: "map", credits: 1 }) },
    { line: evt("scrape_json", { ...base, stage: "scrape_json", credits: 5 }), delayMs: 900 },
    { line: evt("search_contact", { ...base, stage: "search_contact", credits: 2 }) },
    { line: evt("socials", { ...base, stage: "socials" }) },
  ];
  for (let i = 0; i < rejections; i += 1) {
    steps.push({
      line: evt("verification_rejected", {
        ...base,
        kind: i % 2 === 0 ? "phone" : "contact_name",
        value: i % 2 === 0 ? "(555) 010-99" + i : "Alex Placeholder",
        reason: "value not grounded in any fetched source",
      }),
    });
  }
  steps.push({
    line: evt("lead_done", {
      ...base,
      verification_level: level,
      score,
      credits: 8 + rejections,
    }),
    delayMs: 700,
  });
  return steps;
}

function runScript(runId: string, opts: { rejectHeavy?: boolean } = {}): Step[] {
  const { rejectHeavy = false } = opts;
  const steps: Step[] = [
    { line: "2026-01-01 09:00:00 INFO starting mock run" },
    { line: evt("run_started", { run_id: runId, market: "fresno", category: "shopping_center" }) },
    {
      line: evt("capability_detected", {
        run_id: runId,
        max_concurrency: rejectHeavy ? 2 : 5,
        workers: rejectHeavy ? 2 : 4,
        remaining_credits: rejectHeavy ? 220 : 2450,
        plan_credits: 3000,
        source: rejectHeavy ? "cache" : "api",
      }),
    },
    { line: evt("discovery_done", { run_id: runId, count: MOCK_BUSINESSES.length }), delayMs: 1200 },
  ];
  MOCK_BUSINESSES.forEach((lead, i) => {
    steps.push(
      ...leadSteps(runId, lead, {
        rejections: rejectHeavy ? 2 + i : i === 1 ? 1 : 0,
        score: rejectHeavy ? 44 - i * 6 : 82 - i * 9,
        level: rejectHeavy ? (i === 0 ? "partial" : "unverified") : i === 2 ? "partial" : "verified",
      }),
    );
  });
  if (rejectHeavy) {
    steps.push({
      line: evt("firecrawl_throttled", { limit: 2, retry_in: 12 }),
      delayMs: 800,
    });
  }
  steps.push({
    line: evt("run_done", {
      run_id: runId,
      discovered: MOCK_BUSINESSES.length,
      skipped_known: 1,
      enriched: MOCK_BUSINESSES.length,
    }),
    delayMs: 900,
  });
  return steps;
}

function buildScript(scenario: MockScenario): Script {
  const runId = `mock-${Date.now().toString(36)}`;
  switch (scenario) {
    case "happy":
      return {
        kind: "run",
        command: "mock run --market fresno --category shopping_center (happy)",
        status: "completed",
        exitCode: 0,
        steps: runScript(runId),
      };
    case "reject-heavy":
      return {
        kind: "run",
        command: "mock run --market fresno --category shopping_center (reject-heavy)",
        status: "completed",
        exitCode: 0,
        steps: runScript(runId, { rejectHeavy: true }),
      };
    case "fail-fast":
      return {
        kind: "run",
        command: "mock run --market fresno --category shopping_center (fail-fast)",
        status: "failed",
        exitCode: 2,
        steps: [
          { line: evt("run_started", { run_id: runId, market: "fresno", category: "shopping_center" }) },
          {
            line: evt("run_failed", {
              run_id: runId,
              reason: "FIRECRAWL_API_KEY missing — set it in .env (mock)",
            }),
            delayMs: 1200,
          },
          { line: "ERROR preflight failed: FIRECRAWL_API_KEY missing (mock)" },
        ],
      };
    case "doctor":
      return {
        kind: "doctor",
        command: "mock doctor",
        status: "completed",
        exitCode: 0,
        steps: [
          { line: "Google Places: OK — key present, test query returned 3 results" },
          { line: "Firecrawl: OK — 2,450 credits remaining", delayMs: 700 },
          { line: "  plan concurrency 5 → 4 research workers (mock)" },
          { line: "Owner chain: Firecrawl agent (cap 10 lookups/run)" },
          { line: "Google Sheets: MISSING — service account json not found" },
          { line: "Lead DB: data/pallares.db — 128 lead(s), 96 researched", delayMs: 600 },
        ],
      };
  }
}

/** Start a scripted fake job; lines land on an interval like real stdout. */
export function startMockJob(scenario: MockScenario): JobRecord {
  const script = buildScript(scenario);
  const job = createSyntheticJob(script.kind, script.command);

  let index = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  registerSyntheticCancel(job.id, cancel);

  const tick = () => {
    if (index >= script.steps.length) {
      finishSyntheticJob(job.id, script.status, script.exitCode);
      return;
    }
    const step = script.steps[index];
    index += 1;
    appendJobLog(job.id, step.line);
    timer = setTimeout(tick, step.delayMs ?? 450);
  };
  timer = setTimeout(tick, 350);

  return job;
}
