"use client";

import { ChevronDown } from "lucide-react";
import { RunStatusBadge } from "@/components/badges";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { RequestRow } from "@/lib/types";

export function RequestHistory({ requests }: { requests: RequestRow[] }) {
  if (requests.length === 0) {
    return <p className="text-sm text-muted-foreground">No requests yet.</p>;
  }

  return (
    <div className="space-y-2">
      {requests.map((req) => (
        <Collapsible key={req.request_id}>
          <div className="rounded-lg border bg-card transition-colors hover:border-primary/25">
            <CollapsibleTrigger className="group flex w-full cursor-pointer flex-wrap items-center gap-2.5 p-3 text-left">
              <RunStatusBadge status={req.status} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {req.raw_prompt}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {req.leads_delivered} delivered · {req.credits_spent} cr
                {req.usd_spent != null ? ` · $${req.usd_spent.toFixed(2)}` : ""}
              </span>
              <span className="text-xs text-muted-foreground">
                {req.created_at.slice(0, 16).replace("T", " ")}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mx-3 mb-3 max-h-60 overflow-auto rounded-md bg-secondary/60 p-3 font-mono text-xs">
                {JSON.stringify(req.spec, null, 2)}
              </pre>
            </CollapsibleContent>
          </div>
        </Collapsible>
      ))}
    </div>
  );
}
