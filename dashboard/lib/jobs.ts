import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from "fs";
import { readFile, readdir, stat } from "fs/promises";
import path from "path";
import { cliChildEnv } from "./env";
import { dbAvailable, getSql } from "./pg";
import { formatCliCommand, projectRoot, resolveCli } from "./paths";
import { parseLogLineToJobEvent } from "./run-events";
import type { JobEvent, JobRecord, JobStatus, JobSummary } from "./types";

const MAX_CONCURRENT_JOBS = 2;

type SummaryCacheEntry = { mtimeMs: number; summary: JobSummary };

/**
 * All runtime state lives on globalThis so dev-server HMR (which re-evaluates
 * this module) can never orphan a running child process or its subscribers.
 */
type JobsGlobalState = {
  jobs: Map<string, JobRecord>;
  emitters: Map<string, EventEmitter>;
  childProcesses: Map<string, ChildProcess>;
  syntheticCancels: Map<string, () => void>;
  runIdToJobId: Map<string, string>;
  logMeta: Map<string, { firstSeq: number }>;
  summaryCache: Map<string, SummaryCacheEntry>;
  logTailers: Map<string, ReturnType<typeof setInterval>>;
  logPartials: Map<string, string>;
  recovered: boolean;
};

const globalStore = globalThis as typeof globalThis & {
  __pallaresJobs?: JobsGlobalState;
};

const G: JobsGlobalState = (globalStore.__pallaresJobs ??= {
  jobs: new Map(),
  emitters: new Map(),
  childProcesses: new Map(),
  syntheticCancels: new Map(),
  runIdToJobId: new Map(),
  logMeta: new Map(),
  summaryCache: new Map(),
  logTailers: new Map(),
  logPartials: new Map(),
  recovered: false,
});

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FINISHED_STATUSES = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isValidJobId(id: string): boolean {
  if (!JOB_ID_RE.test(id)) return false;
  const base = path.resolve(jobsDir());
  const resolved = path.resolve(jobsDir(), `${id}.json`);
  return resolved.startsWith(`${base}${path.sep}`) || resolved === base;
}

function jobsDir(): string {
  const dir = path.join(projectRoot(), "data", "jobs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function jobLogPath(id: string): string {
  return path.join(jobsDir(), `${id}.log`);
}

function persistJob(job: JobRecord) {
  try {
    const meta = G.logMeta.get(job.id);
    if (meta) job.firstSeq = meta.firstSeq;
    writeFileSync(
      path.join(jobsDir(), `${job.id}.json`),
      JSON.stringify(job, null, 2),
      "utf8",
    );
  } catch {
    // best-effort persistence
  }
}

/** Append a synthetic operator line to the durable log (not from child stdout). */
function appendDurableLogLine(jobId: string, line: string) {
  try {
    const fd = openSync(jobLogPath(jobId), "a");
    try {
      writeSync(fd, `${line}\n`);
    } finally {
      closeSync(fd);
    }
  } catch {
    // best-effort
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Close every DB child run still marked running for a local parent job. */
async function finalizeChildRuns(
  jobId: string,
  status: "cancelled" | "failed" | "interrupted",
  stopReason: string,
): Promise<void> {
  if (!dbAvailable()) return;
  try {
    const sql = getSql();
    // Release claims first so a crash between statements cannot leave
    // enrichment_status='enriching' after the parent is already terminal.
    await sql`
      UPDATE leads
      SET enrichment_status = 'partial'
      WHERE lower(COALESCE(enrichment_status, '')) = 'enriching'
        AND last_run_id IN (
          SELECT run_id FROM runs
          WHERE job_id = ${jobId}
            AND status = 'running'
        )
    `;
    await sql`
      UPDATE runs
      SET status = ${status},
          finished_at = COALESCE(finished_at, now()),
          stop_reason = COALESCE(NULLIF(stop_reason, ''), ${stopReason})
      WHERE job_id = ${jobId}
        AND status = 'running'
    `;
  } catch {
    // best-effort — never block job lifecycle on DB write failures
  }
}

/**
 * One-time startup recovery: persisted `running` jobs whose pid is still
 * alive are reattached as detached; dead ones are finalized as interrupted.
 */
function ensureRecovered() {
  if (G.recovered) return;
  G.recovered = true;
  try {
    for (const file of readdirSync(jobsDir())) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      if (!JOB_ID_RE.test(id) || G.jobs.has(id)) continue;
      let job: JobRecord;
      try {
        job = JSON.parse(readFileSync(path.join(jobsDir(), file), "utf8")) as JobRecord;
      } catch {
        continue;
      }
      if (job.status !== "running" && job.status !== "pending") continue;
      if (job.pid && pidAlive(job.pid)) {
        job.detached = true;
        job.logs ??= [];
        job.events ??= [];
        logMetaFor(id, job);
        G.jobs.set(id, job);
        indexJobEvents(job);
        appendLog(
          job,
          "--- reattached detached job (tailing data/jobs/*.log; no live stdout pipe) ---",
          true,
        );
        attachLogTailer(job);
      } else {
        job.status = "interrupted";
        job.finishedAt ??= new Date().toISOString();
        persistJob(job);
        void finalizeChildRuns(id, "interrupted", "interrupted");
      }
    }
  } catch {
    // best-effort recovery
  }
}

function indexJobEvents(job: JobRecord) {
  for (const evt of job.events) {
    if (typeof evt.run_id === "string" && evt.run_id) {
      G.runIdToJobId.set(evt.run_id, job.id);
    }
  }
}

function normalizePersistedJob(job: JobRecord): JobRecord {
  if ((job.status === "running" || job.status === "pending") && !G.jobs.has(job.id)) {
    return { ...job, status: "interrupted" };
  }
  return job;
}

function tryParseEvent(line: string): JobEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed.t !== "evt" || typeof parsed.event !== "string") return null;
    return parsed as JobEvent;
  } catch {
    return null;
  }
}

function emitterFor(id: string): EventEmitter {
  let emitter = G.emitters.get(id);
  if (!emitter) {
    emitter = new EventEmitter();
    G.emitters.set(id, emitter);
  }
  return emitter;
}

function logMetaFor(id: string, job?: JobRecord): { firstSeq: number } {
  let meta = G.logMeta.get(id);
  if (!meta) {
    meta = { firstSeq: job?.firstSeq ?? 0 };
    G.logMeta.set(id, meta);
  }
  return meta;
}

/** Sequence number of `job.logs[0]` — SSE resume math needs the offset. */
export function jobFirstSeq(id: string): number {
  return G.logMeta.get(id)?.firstSeq ?? 0;
}

function appendLog(job: JobRecord, line: string, durable = false) {
  const meta = logMetaFor(job.id, job);
  if (job.logs.length > 10_000) {
    job.logs.shift();
    meta.firstSeq += 1;
  }
  const seq = meta.firstSeq + job.logs.length;
  job.logs.push(line);
  if (durable) {
    appendDurableLogLine(job.id, line);
    try {
      job.logByteOffset = statSync(jobLogPath(job.id)).size;
    } catch {
      // ignore
    }
  }
  persistJob(job);
  emitterFor(job.id).emit("log", line, seq);
  const evt = tryParseEvent(line);
  if (evt) {
    evt._seq = seq;
    job.events.push(evt);
    if (typeof evt.run_id === "string" && evt.run_id) {
      G.runIdToJobId.set(evt.run_id, job.id);
    }
    emitterFor(job.id).emit("event", evt);
  }
}

function ingestLogChunk(job: JobRecord, chunk: string) {
  const partial = (G.logPartials.get(job.id) ?? "") + chunk;
  const parts = partial.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  G.logPartials.set(job.id, rest);
  for (const line of parts) {
    if (line.trim()) appendLog(job, line);
  }
}

/** Tail durable CLI log so recovered (detached) jobs keep streaming events. */
function attachLogTailer(job: JobRecord) {
  if (G.logTailers.has(job.id)) return;
  const logPath = jobLogPath(job.id);
  if (job.logByteOffset == null) {
    try {
      job.logByteOffset = existsSync(logPath) ? statSync(logPath).size : 0;
    } catch {
      job.logByteOffset = 0;
    }
  }
  const tick = () => {
    const live = G.jobs.get(job.id);
    if (!live || FINISHED_STATUSES.has(live.status)) {
      const timer = G.logTailers.get(job.id);
      if (timer) clearInterval(timer);
      G.logTailers.delete(job.id);
      return;
    }
    if (live.detached && live.pid && !pidAlive(live.pid)) {
      reapDetachedJob(live);
      return;
    }
    try {
      if (!existsSync(logPath)) return;
      const size = statSync(logPath).size;
      let offset = live.logByteOffset ?? 0;
      if (size < offset) offset = 0;
      if (size === offset) return;
      const fd = openSync(logPath, "r");
      try {
        const buf = Buffer.alloc(size - offset);
        readSync(fd, buf, 0, buf.length, offset);
        live.logByteOffset = size;
        ingestLogChunk(live, buf.toString("utf8"));
      } finally {
        closeSync(fd);
      }
    } catch {
      // best-effort tail
    }
  };
  const timer = setInterval(tick, 1000);
  G.logTailers.set(job.id, timer);
  tick();
}

function runningJobCount(): number {
  let count = 0;
  for (const job of G.jobs.values()) {
    if (job.status === "running" || job.status === "pending") count += 1;
  }
  return count;
}

/** Finalize a detached (recovered) job whose pid has since died. */
function reapDetachedJob(job: JobRecord) {
  const timer = G.logTailers.get(job.id);
  if (timer) {
    clearInterval(timer);
    G.logTailers.delete(job.id);
  }
  job.status = "interrupted";
  job.finishedAt = new Date().toISOString();
  appendLog(job, "--- process ended while the dashboard was restarting ---", true);
  persistJob(job);
  void finalizeChildRuns(job.id, "interrupted", "interrupted");
  emitterFor(job.id).emit("done", job);
}

export function getJob(id: string): JobRecord | undefined {
  ensureRecovered();
  const job = G.jobs.get(id);
  if (job?.detached && job.status === "running" && (!job.pid || !pidAlive(job.pid))) {
    reapDetachedJob(job);
  }
  return job;
}

export function listJobs(limit = 20): JobRecord[] {
  ensureRecovered();
  const seen = new Map<string, JobRecord>();
  for (const job of G.jobs.values()) {
    seen.set(job.id, job);
  }
  try {
    for (const file of readdirSync(jobsDir())) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      if (seen.has(id)) continue;
      const job = loadPersistedJob(id);
      if (job) seen.set(id, job);
    }
  } catch {
    // best-effort listing
  }
  return [...seen.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

function summarize(job: JobRecord): JobSummary {
  let runId: string | null = null;
  let market: string | null = null;
  let category: string | null = null;
  // Prefer the latest cell — campaigns fan out many run_ids over time.
  for (const evt of job.events) {
    if (typeof evt.run_id === "string" && evt.run_id) runId = evt.run_id;
    if (evt.event === "run_started") {
      if (typeof evt.market === "string") market = evt.market;
      if (typeof evt.category === "string") category = evt.category;
    } else {
      if (typeof evt.market === "string") market = evt.market;
      if (typeof evt.category === "string") category = evt.category;
    }
  }
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    command: job.command,
    args: job.args,
    exitCode: job.exitCode,
    pid: job.pid,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    detached: job.detached,
    executionMode: job.executionMode ?? "local",
    runId,
    market,
    category,
  };
}

export async function listJobSummaries(limit = 20): Promise<JobSummary[]> {
  ensureRecovered();
  const seen = new Map<string, JobSummary>();
  for (const job of G.jobs.values()) {
    if (job.detached) getJob(job.id);
    seen.set(job.id, summarize(job));
  }
  try {
    const files = await readdir(jobsDir());
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.slice(0, -5);
      if (seen.has(id) || !JOB_ID_RE.test(id)) continue;
      const fullPath = path.join(jobsDir(), file);
      try {
        const info = await stat(fullPath);
        const cached = G.summaryCache.get(id);
        if (cached && cached.mtimeMs === info.mtimeMs) {
          seen.set(id, cached.summary);
          continue;
        }
        const job = normalizePersistedJob(
          JSON.parse(await readFile(fullPath, "utf8")) as JobRecord,
        );
        const summary = summarize(job);
        G.summaryCache.set(id, { mtimeMs: info.mtimeMs, summary });
        if (summary.runId && !G.runIdToJobId.has(summary.runId)) {
          G.runIdToJobId.set(summary.runId, id);
        }
        seen.set(id, summary);
      } catch {
        // skip unreadable/corrupt job files
      }
    }
  } catch {
    // best-effort listing
  }
  return [...seen.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export function loadPersistedJob(id: string): JobRecord | null {
  ensureRecovered();
  const inMemory = getJob(id);
  if (inMemory) return inMemory;
  if (!isValidJobId(id)) return null;
  const file = path.join(jobsDir(), `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    const job = JSON.parse(readFileSync(file, "utf8")) as JobRecord;
    return normalizePersistedJob(job);
  } catch {
    return null;
  }
}

export function findJobByRunId(runId: string): JobRecord | null {
  ensureRecovered();
  const indexed = G.runIdToJobId.get(runId);
  if (indexed) return getJob(indexed) ?? loadPersistedJob(indexed);
  for (const job of listJobs(200)) {
    if (job.events.some((evt) => evt.run_id === runId)) {
      G.runIdToJobId.set(runId, job.id);
      return job;
    }
    for (const line of job.logs) {
      const evt = parseLogLineToJobEvent(line);
      if (evt?.run_id === runId) {
        G.runIdToJobId.set(runId, job.id);
        return job;
      }
    }
  }
  return null;
}

export function subscribeJob(
  id: string,
  onLog: (line: string, seq: number) => void,
  onDone: (job: JobRecord) => void,
  onEvent?: (event: JobEvent) => void,
): () => void {
  const job = getJob(id) ?? loadPersistedJob(id);
  const emitter = emitterFor(id);
  emitter.on("log", onLog);
  emitter.on("done", onDone);
  if (onEvent) emitter.on("event", onEvent);
  if (job && job.status !== "running" && job.status !== "pending") {
    onDone(job);
  }
  return () => {
    emitter.off("log", onLog);
    emitter.off("done", onDone);
    if (onEvent) emitter.off("event", onEvent);
  };
}

export class JobConcurrencyError extends Error {
  constructor() {
    super("Too many concurrent jobs — wait for a running job to finish");
    this.name = "JobConcurrencyError";
  }
}

export async function cancelJob(id: string): Promise<JobRecord | null> {
  if (!isValidJobId(id)) return null;
  const job = getJob(id);
  if (!job || job.status !== "running") {
    return job ?? loadPersistedJob(id);
  }

  const synthetic = G.syntheticCancels.get(id);
  const child = G.childProcesses.get(id);
  const pid = child?.pid ?? job.pid;
  if (synthetic) {
    synthetic();
    G.syntheticCancels.delete(id);
  } else if (pid) {
    try {
      process.kill(pid);
    } catch {
      // process may already be gone
    }
  } else {
    return job;
  }

  await finalizeChildRuns(id, "cancelled", "cancelled");

  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  appendLog(job, "--- cancelled by user ---");
  persistJob(job);
  emitterFor(id).emit("done", job);
  G.childProcesses.delete(id);
  return job;
}

export function startJob(
  kind: JobRecord["kind"],
  args: string[],
  extraEnv?: Record<string, string>,
): JobRecord {
  ensureRecovered();
  if (runningJobCount() >= MAX_CONCURRENT_JOBS) {
    throw new JobConcurrencyError();
  }

  const { command, baseArgs, cwd } = resolveCli();
  const id = randomUUID();
  const job: JobRecord = {
    id,
    kind,
    status: "pending",
    command: formatCliCommand(command, baseArgs, args),
    args,
    logs: [],
    events: [],
    exitCode: null,
    pid: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    executionMode: "local",
  };
  G.jobs.set(id, job);
  persistJob(job);

  // Redirect CLI stdout/stderr to a durable file so dashboard restarts can
  // re-tail telemetry (pipes die with the old Node parent).
  const logFd = openSync(jobLogPath(id), "a");
  const child = spawn(command, [...baseArgs, ...args], {
    cwd,
    env: { ...cliChildEnv(), ...extraEnv, PALLARES_JOB_ID: id },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);

  job.status = "running";
  job.pid = child.pid ?? null;
  job.logByteOffset = 0;
  G.childProcesses.set(id, child);
  persistJob(job);
  appendLog(job, `$ ${job.command}`, true);
  attachLogTailer(job);

  const finalize = (status: JobStatus, code: number | null, line: string) => {
    const alreadyTerminal = FINISHED_STATUSES.has(job.status);
    // Drain any remaining log bytes before closing the tailer.
    const tailer = G.logTailers.get(id);
    if (tailer) {
      clearInterval(tailer);
      G.logTailers.delete(id);
    }
    try {
      const logPath = jobLogPath(id);
      if (existsSync(logPath)) {
        const size = statSync(logPath).size;
        const offset = job.logByteOffset ?? 0;
        if (size > offset) {
          const fd = openSync(logPath, "r");
          try {
            const buf = Buffer.alloc(size - offset);
            readSync(fd, buf, 0, buf.length, offset);
            job.logByteOffset = size;
            ingestLogChunk(job, buf.toString("utf8"));
          } finally {
            closeSync(fd);
          }
        }
      }
    } catch {
      // ignore drain errors
    }
    const partial = G.logPartials.get(id);
    if (partial?.trim()) appendLog(job, partial.trim());
    G.logPartials.delete(id);
    if (!alreadyTerminal) {
      job.exitCode = code;
      job.finishedAt = new Date().toISOString();
      job.status = status;
      appendLog(job, line, true);
      persistJob(job);
      emitterFor(id).emit("done", job);
    }
    G.childProcesses.delete(id);
    // Always sweep children — cancel may have raced ahead of close, and a
    // completed campaign must not leave orphan RUNNING cells.
    const sweepStatus =
      job.status === "cancelled"
        ? "cancelled"
        : job.status === "interrupted"
          ? "interrupted"
          : "failed";
    const sweepReason =
      job.status === "completed" || status === "completed" ? "orphaned" : sweepStatus;
    void finalizeChildRuns(id, sweepStatus, sweepReason);
  };

  child.on("close", (code) => {
    finalize(code === 0 ? "completed" : "failed", code, `--- exit ${code} ---`);
  });

  child.on("error", (err) => {
    finalize("failed", null, `spawn error: ${err.message}`);
  });

  return job;
}

export function setJobStatus(id: string, status: JobStatus) {
  const job = G.jobs.get(id);
  if (job) {
    job.status = status;
    persistJob(job);
  }
}

export function createSyntheticJob(
  kind: JobRecord["kind"],
  command: string,
): JobRecord {
  ensureRecovered();
  if (runningJobCount() >= MAX_CONCURRENT_JOBS) {
    throw new JobConcurrencyError();
  }
  const id = randomUUID();
  const job: JobRecord = {
    id,
    kind,
    status: "running",
    command,
    args: command.split(" ").slice(1),
    logs: [],
    events: [],
    exitCode: null,
    pid: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    executionMode: "local",
  };
  G.jobs.set(id, job);
  appendLog(job, `$ ${command}`);
  return job;
}

export function appendJobLog(id: string, line: string): void {
  const job = G.jobs.get(id);
  if (!job || FINISHED_STATUSES.has(job.status)) return;
  appendLog(job, line);
}

export function finishSyntheticJob(
  id: string,
  status: JobStatus,
  exitCode: number | null,
): void {
  const job = G.jobs.get(id);
  if (!job || FINISHED_STATUSES.has(job.status)) return;
  job.status = status;
  job.exitCode = exitCode;
  job.finishedAt = new Date().toISOString();
  appendLog(job, `--- exit ${exitCode ?? "?"} ---`);
  persistJob(job);
  G.syntheticCancels.delete(id);
  emitterFor(id).emit("done", job);
}

export function registerSyntheticCancel(id: string, cancel: () => void): void {
  G.syntheticCancels.set(id, cancel);
}
