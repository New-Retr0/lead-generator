import { getJob, loadPersistedJob, subscribeJob } from "@/lib/jobs";
import type { JobRecord, JobStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TERMINAL_STATUSES = new Set<JobStatus>([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const activeJob = getJob(id);
  const job = activeJob ?? loadPersistedJob(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let pollInterval: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const sendDone = (finished: JobRecord) => {
        send("done", { status: finished.status, exitCode: finished.exitCode });
        controller.close();
      };

      for (const line of job.logs) {
        send("log", { line });
      }
      for (const evt of job.events) {
        send("event", evt);
      }

      if (TERMINAL_STATUSES.has(job.status)) {
        sendDone(job);
        return;
      }

      if (!activeJob) {
        let sentLogs = job.logs.length;
        let sentEvents = job.events.length;
        pollInterval = setInterval(() => {
          const next = loadPersistedJob(id);
          if (!next) {
            send("done", { status: "interrupted", exitCode: null });
            controller.close();
            if (pollInterval) clearInterval(pollInterval);
            return;
          }
          for (const line of next.logs.slice(sentLogs)) {
            send("log", { line });
          }
          for (const evt of next.events.slice(sentEvents)) {
            send("event", evt);
          }
          sentLogs = next.logs.length;
          sentEvents = next.events.length;
          if (TERMINAL_STATUSES.has(next.status)) {
            sendDone(next);
            if (pollInterval) clearInterval(pollInterval);
          }
        }, 500);
        return;
      }

      unsubscribe = subscribeJob(
        id,
        (line) => send("log", { line }),
        (finished) => {
          unsubscribe?.();
          send("done", { status: finished.status, exitCode: finished.exitCode });
          controller.close();
        },
        (evt) => send("event", evt),
      );
    },
    cancel() {
      unsubscribe?.();
      if (pollInterval) clearInterval(pollInterval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
