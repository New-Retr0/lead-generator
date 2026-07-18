"use client";

import { useEffect, useState } from "react";
import { SquareTerminal, Stethoscope } from "lucide-react";
import { motion } from "motion/react";
import { AsciiSpinner } from "@/components/console/ascii-spinner";
import { DoctorHealthPanel } from "@/components/doctor-health-panel";
import { JobTimeline } from "@/components/job-timeline";
import { enter, progress, spring } from "@/components/console/motion";
import { apiFetch } from "@/lib/api-client";

function RunTimelinePlaceholder() {
  return (
    <div className="panel-strong panel-sheen rounded-2xl border border-dashed border-border/60 p-8 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary/80 text-white shadow-lg">
        <SquareTerminal className="size-5" strokeWidth={2.25} />
      </div>
      <p className="mt-4 text-sm font-medium">Live run timeline</p>
      <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
        Launch a run to watch per-place progress — discover, research, verify, and spend credits —
        stream here in real time.
      </p>
    </div>
  );
}

function DoctorPlaceholder() {
  return (
    <motion.div
      {...enter.scaleIn}
      transition={spring.soft}
      className="panel-strong panel-sheen overflow-hidden rounded-2xl border border-dashed border-border/60"
    >
      <div className={progress.trackClass}>
        <motion.div
          className={progress.fillClass}
          animate={{ x: ["-100%", "400%"] }}
          transition={progress.bar}
        />
      </div>
      <div className="p-8 text-center">
        <motion.div
          animate={{ scale: [1, 1.04, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary/80 text-white shadow-lg"
        >
          <Stethoscope className="size-5" strokeWidth={2.25} />
        </motion.div>
        <p className="mt-4 text-sm font-medium">Starting health check…</p>
        <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
          Running pallares-leads doctor — checks reveal one at a time so nothing flashes past.
        </p>
        <AsciiSpinner className="mx-auto mt-4 text-2xl" />
      </div>
    </motion.div>
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
    void apiFetch(`/api/jobs/${jobId}`)
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
      <div className="panel-strong panel-sheen rounded-2xl border border-dashed border-border/60 p-8 text-center">
        <AsciiSpinner className="text-2xl" />
        <p className="mt-4 text-sm text-muted-foreground">Loading job…</p>
      </div>
    );
  }
  if (kind === "doctor") {
    return <DoctorHealthPanel key={jobId} jobId={jobId} onDone={onDone} />;
  }
  return <JobTimeline jobId={jobId} onDone={onDone} />;
}
