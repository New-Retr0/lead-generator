"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Stethoscope } from "lucide-react";
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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data) => {
        const running = (data.jobs ?? []).find(
          (j: { status: string; id: string }) => j.status === "running",
        );
        setActiveJobId(running?.id ?? null);
      });
  }, []);

  const runDoctor = async () => {
    setDoctorOpen(true);
    setDoctorJobId(null);
    const res = await fetch("/api/jobs/doctor", { method: "POST" });
    const data = await res.json();
    if (res.ok) setDoctorJobId(data.jobId);
  };

  return (
    <>
      {activeJobId ? <JobLogPanel jobId={activeJobId} /> : null}

      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" onClick={() => void runDoctor()}>
          <Stethoscope className="size-4" />
          Health check
        </Button>
        <Button asChild>
          <Link href="/requests">
            <Sparkles className="size-4" />
            New request
          </Link>
        </Button>
      </div>

      <Dialog open={doctorOpen} onOpenChange={setDoctorOpen}>
        <DialogContent className="glass-strong glass-sheen sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>System health check</DialogTitle>
            <DialogDescription>
              Verifies Google Places, Firecrawl, AI Gateway, Browser Use balances, Google Sheets,
              and the lead database.
            </DialogDescription>
          </DialogHeader>
          <JobLogPanel
            jobId={doctorJobId}
            onDone={() => {
              onDoctorComplete?.();
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
