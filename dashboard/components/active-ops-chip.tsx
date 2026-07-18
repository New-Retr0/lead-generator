"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LiveDot } from "@/components/animated";
import { Badge } from "@/components/ui/badge";
import { useVisibilityInterval } from "@/hooks/use-visibility-interval";
import { apiFetch } from "@/lib/api-client";

type ActiveOp = {
  href: string;
  label: string;
  count: number;
};

export function ActiveOpsChip() {
  const [active, setActive] = useState<ActiveOp | null>(null);

  const poll = useCallback(() => {
    void apiFetch("/api/runs")
      .then((r) => r.json())
      .then(
        (data: {
          jobs?: {
            id: string;
            status: string;
            runId?: string | null;
            kind?: string;
          }[];
          runs?: { run_id: string; status: string }[];
        }) => {
          const liveJobs = (data.jobs ?? []).filter(
            (j) => j.status === "running" || j.status === "pending",
          );
          // Prefer local jobs as the operator execution unit; DB cells are children.
          const count = liveJobs.length;
          if (count <= 0) {
            setActive(null);
            return;
          }
          const preferredJob = liveJobs[0];
          const href = preferredJob
            ? `/runs?job=${encodeURIComponent(preferredJob.id)}`
            : "/runs";
          setActive({
            href,
            label: preferredJob?.kind === "doctor" ? "Health" : "Active Ops",
            count,
          });
        },
      )
      .catch(() => {
        setActive(null);
      });
  }, []);

  useEffect(() => {
    poll();
  }, [poll]);

  useVisibilityInterval(poll, 8_000);

  if (!active) {
    return (
      <span className="hidden items-center gap-2 rounded-full border border-border/60 bg-card px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground sm:flex">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" />
        Idle
      </span>
    );
  }

  return (
    <Link
      href={active.href}
      data-testid="active-ops-chip"
      className="hidden items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-primary transition-colors hover:bg-primary/15 sm:flex"
    >
      <LiveDot tone="primary" />
      {active.label}
      <Badge variant="default" className="h-4 min-w-4 justify-center px-1 tabular-nums">
        {active.count}
      </Badge>
    </Link>
  );
}
