import { getJob, jobFirstSeq, loadPersistedJob, subscribeJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FINISHED = new Set(["completed", "failed", "cancelled", "interrupted"]);

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = getJob(id) ?? loadPersistedJob(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  // Resume cursor: browsers send Last-Event-ID on native reconnect; manual
  // retries (after the client fell back to polling) pass ?lastEventId=.
  const url = new URL(req.url);
  const rawCursor =
    req.headers.get("last-event-id") ?? url.searchParams.get("lastEventId");
  const cursor =
    rawCursor != null && /^\d+$/.test(rawCursor) ? Number(rawCursor) : null;

  const live = job.status === "running" || job.status === "pending";

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown, seq?: number) => {
        if (closed) return;
        const idLine = seq != null ? `id: ${seq}\n` : "";
        try {
          controller.enqueue(
            encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (ping) clearInterval(ping);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed by the client
        }
      };

      const firstSeq = jobFirstSeq(job.id);
      let replayedLines = 0;
      for (let i = 0; i < job.logs.length; i += 1) {
        const seq = firstSeq + i;
        if (cursor != null && seq <= cursor) continue;
        send("log", { line: job.logs[i], seq }, seq);
        replayedLines += 1;
      }
      for (const evt of job.events) {
        const seq = typeof evt._seq === "number" ? evt._seq : undefined;
        if (cursor != null && seq != null && seq <= cursor) continue;
        send("event", evt, seq);
      }
      send("ready", { status: job.status, replayedLines });

      if (FINISHED.has(job.status)) {
        send("done", { status: job.status, exitCode: job.exitCode, live: false });
        close();
        return;
      }

      unsubscribe = subscribeJob(
        id,
        (line, seq) => send("log", { line, seq }, seq),
        (finished) => {
          send("done", {
            status: finished.status,
            exitCode: finished.exitCode,
            live,
          });
          close();
        },
        (evt) =>
          send("event", evt, typeof evt._seq === "number" ? evt._seq : undefined),
      );

      ping = setInterval(() => {
        if (closed) return;
        getJob(id);
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, 15_000);
    },
    cancel() {
      closed = true;
      if (ping) clearInterval(ping);
      unsubscribe?.();
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
