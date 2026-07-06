import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RunDetailContent } from "@/components/runs/run-detail-content";
import { Button } from "@/components/ui/button";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="font-mono text-[10px] uppercase tracking-[0.12em]">
        <Link href="/runs">
          <ArrowLeft className="size-3.5" />
          All runs
        </Link>
      </Button>
      <RunDetailContent runId={id} />
    </div>
  );
}
