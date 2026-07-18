import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RunDetailContent } from "@/components/runs/run-detail-content";
import { Button } from "@/components/ui/button";
import { buildRunDetailResponse } from "@/lib/run-detail-payload";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const initialDetail = await buildRunDetailResponse(id);

  return (
    <div className="min-w-0 w-full max-w-full space-y-4">
      <Button asChild variant="ghost" size="sm" className="font-mono text-[10px] uppercase tracking-[0.12em]">
        <Link href="/runs">
          <ArrowLeft className="size-3.5" />
          All runs
        </Link>
      </Button>
      <RunDetailContent runId={id} initialDetail={initialDetail} />
    </div>
  );
}
