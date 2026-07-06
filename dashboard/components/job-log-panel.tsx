"use client";

import { useEffect, useState } from "react";
import { SquareTerminal, Stethoscope } from "lucide-react";
import { AsciiSpinner } from "@/components/console/ascii-spinner";
import { DoctorHealthPanel } from "@/components/doctor-health-panel";
import { JobTimeline } from "@/components/job-timeline";

function RunTimelinePlaceholder() {
  return (
    <div className="glass-strong glass-sheen rounded-2xl border border-dashed border-border/60 p-8 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-[oklch(0.55_0.16_300)] text-white shadow-lg">
        <SquareTerminal className="size-5" strokeWidth={2.25} />
      </div>
      <p className="mt-4 text-sm font-medium">Live run timeline</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Launch a run to watch per-place progress — discover, enrich, verify, and spend credits —
        stream here in real time.
      </p>
    </div>
  );
}

function DoctorPlaceholder() {
  return (
    <div className="glass-strong glass-sheen rounded-2xl border border-dashed border-border/60 p-8 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-[oklch(0.55_0.16_300)] text-white shadow-lg">
        <Stethoscope className="size-5" strokeWidth={2.25} />
      </div>
      <p className="mt-4 text-sm font-medium">Starting health check…</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Running pallares-leads doctor — service checks will stream in shortly.
      </p>
      <AsciiSpinner className="mx-auto mt-4 text-2xl" />
    </div>
  );
}

export function JobLogPanel({
  jobId,
  onDone,
  variant = "run",
}: {
  jobId: string | null;
  onDone?: (status: string) => void;
  variant?: "doctor" | "run";
}) {
  if (!jobId) {
    return variant === "doctor" ? <DoctorPlaceholder /> : <RunTimelinePlaceholder />;
  }
  return <JobLogPanelActive jobId={jobId} onDone={onDone} />;
}

function JobLogPanelActive({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone?: (status: string) => void;
}) {
  const [kind, setKind] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/jobs/${jobId}`)
      .then((r) => r.json())
      .then((body: { job?: { kind?: string } }) => {
        if (!cancelled) setKind(body.job?.kind ?? "run");
      })
      .catch(() => {
        if (!cancelled) setKind("run");
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (kind === null) {
    return (
      <div className="glass-strong glass-sheen rounded-2xl border border-dashed border-border/60 p-8 text-center">
        <AsciiSpinner className="text-2xl" />
        <p className="mt-4 text-sm text-muted-foreground">Loading job…</p>
      </div>
    );
  }
  if (kind === "doctor") {
    return <DoctorHealthPanel jobId={jobId} onDone={onDone} />;
  }
  return <JobTimeline jobId={jobId} onDone={onDone} />;
}
