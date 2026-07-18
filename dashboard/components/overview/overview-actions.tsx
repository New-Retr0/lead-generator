"use client";

import { useState } from "react";
import Link from "next/link";
import { Rocket, Stethoscope } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { JobLogPanel } from "@/components/job-log-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function OverviewActions({
  onDoctorComplete,
}: {
  onDoctorComplete?: () => void;
}) {
  const [doctorJobId, setDoctorJobId] = useState<string | null>(null);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [doctorError, setDoctorError] = useState<string | null>(null);

  const runDoctor = async () => {
    setDoctorOpen(true);
    setDoctorJobId(null);
    setDoctorError(null);
    try {
      const res = await apiFetch("/api/jobs/doctor", { method: "POST" });
      const data = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok) {
        setDoctorError(data.error ?? "Failed to start health check");
        return;
      }
      setDoctorJobId(data.jobId ?? null);
    } catch (err) {
      setDoctorError(err instanceof Error ? err.message : "Failed to start health check");
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" onClick={() => void runDoctor()}>
          <Stethoscope className="size-4" />
          Health check
        </Button>
        <Button asChild>
          <Link href="/launch?mode=campaign">
            <Rocket className="size-4" />
            Launch
          </Link>
        </Button>
      </div>

      <Dialog
        open={doctorOpen}
        onOpenChange={(open) => {
          setDoctorOpen(open);
          if (!open) {
            setDoctorJobId(null);
            setDoctorError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden border-primary/20 bg-card p-4 shadow-2xl sm:max-w-2xl sm:p-6">
          <DialogHeader className="shrink-0">
            <DialogTitle>System health check</DialogTitle>
            <DialogDescription>
              Verifies Google Places, Firecrawl (live plan + credits), Supabase, and the lead
              database. Local execution via CLI doctor.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {doctorError ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/40 p-8 text-center">
                <p className="text-sm text-destructive">{doctorError}</p>
                <Button variant="outline" size="sm" onClick={() => void runDoctor()}>
                  Retry
                </Button>
              </div>
            ) : (
              <JobLogPanel
                jobId={doctorJobId}
                variant="doctor"
                onDone={() => {
                  onDoctorComplete?.();
                }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
