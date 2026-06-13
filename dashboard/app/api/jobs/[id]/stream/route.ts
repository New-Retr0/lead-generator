import { getJob, loadPersistedJob, subscribeJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = getJob(id) ?? loadPersistedJob(id);
  if (!job) {
    return new Response("Job not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      for (const line of job.logs) {
        send("log", { line });
      }
      for (const evt of job.events) {
        send("event", evt);
      }

      if (job.status === "completed" || job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") {
        send("done", { status: job.status, exitCode: job.exitCode });
        controller.close();
        return;
      }

      if (job.status === "running" && !getJob(id)) {
        send("done", { status: "interrupted", exitCode: job.exitCode });
        controller.close();
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
