import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { cliChildEnv } from "./env";
import { formatCliCommand, projectRoot, resolveCli } from "./paths";
import type { JobEvent, JobRecord, JobStatus } from "./types";

const jobs = new Map<string, JobRecord>();
const emitters = new Map<string, EventEmitter>();
const childProcesses = new Map<string, ChildProcess>();

const MAX_CONCURRENT_JOBS = 2;

const JOB_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function persistJob(job: JobRecord) {
  try {
    writeFileSync(
      path.join(jobsDir(), `${job.id}.json`),
      JSON.stringify(job, null, 2),
      "utf8",
    );
  } catch {
    // best-effort persistence
  }
}

function normalizePersistedJob(job: JobRecord): JobRecord {
  if (job.status === "running" && !jobs.has(job.id)) {
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
  let emitter = emitters.get(id);
  if (!emitter) {
    emitter = new EventEmitter();
    emitters.set(id, emitter);
  }
  return emitter;
}

function appendLog(job: JobRecord, line: string) {
  if (job.logs.length > 10_000) {
    job.logs.shift();
  }
  job.logs.push(line);
  emitterFor(job.id).emit("log", line);
  const evt = tryParseEvent(line);
  if (evt) {
    job.events.push(evt);
    emitterFor(job.id).emit("event", evt);
  }
}

function runningJobCount(): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === "running" || job.status === "pending") count += 1;
  }
  return count;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

export function listJobs(limit = 20): JobRecord[] {
  const seen = new Map<string, JobRecord>();
  for (const job of jobs.values()) {
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

export function loadPersistedJob(id: string): JobRecord | null {
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
  for (const job of listJobs(50)) {
    if (job.events.some((evt) => evt.run_id === runId)) return job;
  }
  return null;
}

export function subscribeJob(
  id: string,
  onLog: (line: string) => void,
  onDone: (job: JobRecord) => void,
  onEvent?: (event: JobEvent) => void,
): () => void {
  const job = jobs.get(id) ?? loadPersistedJob(id);
  const emitter = emitterFor(id);
  emitter.on("log", onLog);
  emitter.on("done", onDone);
  if (onEvent) emitter.on("event", onEvent);
  if (
    job &&
    job.status !== "running" &&
    job.status !== "pending"
  ) {
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

export function cancelJob(id: string): JobRecord | null {
  if (!isValidJobId(id)) return null;
  const job = jobs.get(id);
  const child = childProcesses.get(id);
  if (!job || job.status !== "running" || !child?.pid) {
    return job ?? loadPersistedJob(id);
  }
  try {
    process.kill(child.pid);
  } catch {
    // process may already be gone
  }
  job.status = "cancelled";
  job.finishedAt = new Date().toISOString();
  appendLog(job, "--- cancelled by user ---");
  persistJob(job);
  emitterFor(id).emit("done", job);
  childProcesses.delete(id);
  return job;
}

export function startJob(
  kind: JobRecord["kind"],
  args: string[],
  extraEnv?: Record<string, string>,
): JobRecord {
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
  };
  jobs.set(id, job);

  const child = spawn(command, [...baseArgs, ...args], {
    cwd,
    env: { ...cliChildEnv(), ...extraEnv },
    shell: false,
    windowsHide: true,
  });

  job.status = "running";
  job.pid = child.pid ?? null;
  childProcesses.set(id, child);
  appendLog(job, `$ ${job.command}`);

  const onData = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) appendLog(job, line);
    }
  };

  child.stdout.on("data", onData);
  child.stderr.on("data", onData);

  const finalize = (status: JobStatus, code: number | null, line: string) => {
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    job.status = status;
    appendLog(job, line);
    persistJob(job);
    childProcesses.delete(id);
    emitterFor(id).emit("done", job);
    child.stdout?.removeListener("data", onData);
    child.stderr?.removeListener("data", onData);
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
  const job = jobs.get(id);
  if (job) job.status = status;
}
