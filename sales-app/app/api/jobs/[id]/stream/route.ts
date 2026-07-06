import { parseLogLineToJobEvent } from "@/lib/run-events";
import { getPipelineJob } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function terminalStatus(status: string): boolean {
  return ["succeeded", "failed", "cancelled"].includes(status);
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = await getPipelineJob(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastLogCount = 0;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const emitJobSnapshot = (row: NonNullable<Awaited<ReturnType<typeof getPipelineJob>>>) => {
        const logs = Array.isArray(row.logs) ? row.logs.map(String) : [];
        for (let i = lastLogCount; i < logs.length; i += 1) {
          send("log", { line: logs[i] });
          const evt = parseLogLineToJobEvent(logs[i] ?? "");
          if (evt) send("event", evt);
        }
        lastLogCount = logs.length;

        if (terminalStatus(String(row.status))) {
          send("done", { status: row.status });
          controller.close();
          if (timer) clearInterval(timer);
        }
      };

      emitJobSnapshot(job);

      if (terminalStatus(String(job.status))) {
        return;
      }

      timer = setInterval(() => {
        void getPipelineJob(id)
          .then((row) => {
            if (!row) {
              send("done", { status: "failed" });
              controller.close();
              if (timer) clearInterval(timer);
              return;
            }
            emitJobSnapshot(row);
          })
          .catch(() => {
            send("done", { status: "error" });
            controller.close();
            if (timer) clearInterval(timer);
          });
      }, 2000);
    },
    cancel() {
      if (timer) clearInterval(timer);
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
