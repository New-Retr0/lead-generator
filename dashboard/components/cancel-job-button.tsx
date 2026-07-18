"use client";

import { useState } from "react";
import { Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/fetcher";

export function CancelJobButton({
  jobId,
  visible,
}: {
  jobId: string;
  visible: boolean;
}) {
  const [cancelling, setCancelling] = useState(false);

  if (!visible) return null;

  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      className="h-7 px-2.5 font-mono text-[10px] uppercase tracking-[0.1em]"
      disabled={cancelling}
      data-testid="cancel-job"
      onClick={() => {
        setCancelling(true);
        void fetchJson(`/api/jobs/${jobId}`, { method: "DELETE" })
          .catch(() => undefined)
          .finally(() => setCancelling(false));
      }}
    >
      <Square className="size-3.5 fill-current" />
      {cancelling ? "Cancelling…" : "Cancel"}
    </Button>
  );
}
