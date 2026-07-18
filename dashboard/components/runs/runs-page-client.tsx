"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { CancelJobButton } from "@/components/cancel-job-button";
import { RunStatusBadge, StopReasonBadge } from "@/components/badges";
import { StatCard } from "@/components/stat-card";
import { AsciiSpinner } from "@/components/console/ascii-spinner";
import ASCIIAnimation from "@/components/console/ascii-animation";
import { SectionHeading } from "@/components/console/section-heading";
import { SectionReveal } from "@/components/console/section-reveal";
import { TypedText } from "@/components/console/typed-text";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { JobSummary, PipelineConfig, RunRow } from "@/lib/types";
import { cn, formatPct } from "@/lib/utils";

const ALL = "__all__";

export function RunsPageClient({
  initialRuns,
  initialJobs,
  config,
  initialJobFilter,
}: {
  initialRuns: RunRow[];
  initialJobs: JobSummary[];
  config: PipelineConfig;
  initialJobFilter?: string | null;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [jobs, setJobs] = useState(initialJobs);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [marketFilter, setMarketFilter] = useState(ALL);
  const [jobFilter, setJobFilter] = useState<string | null>(initialJobFilter ?? null);
  const [repairing, setRepairing] = useState(false);
  const router = useRouter();

  const refreshRuns = useCallback(() => {
    void fetch("/api/runs", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setRuns(data.runs ?? []);
        setJobs(data.jobs ?? []);
      });
  }, []);

  const hasRunning =
    runs.some((r) => r.status === "running") ||
    jobs.some((j) => j.status === "running" || j.status === "pending");

  useEffect(() => {
    refreshRuns();
    const id = window.setInterval(refreshRuns, 10_000);
    return () => window.clearInterval(id);
  }, [refreshRuns]);

  const liveJobs = useMemo(
    () => jobs.filter((j) => j.status === "running" || j.status === "pending"),
    [jobs],
  );

  const analytics = useMemo(() => {
    const total = runs.length;
    const completed = runs.filter((r) => r.status === "completed").length;
    const running = runs.filter((r) => r.status === "running").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const discovered = runs.reduce((sum, r) => sum + r.discovered_count, 0);
    const enriched = runs.reduce((sum, r) => sum + r.enriched_count, 0);
    const completedRate = total > 0 ? completed / total : 0;
    return { total, completed, completedRate, running, failed, discovered, enriched };
  }, [runs]);

  const runTypes = useMemo(
    () => [...new Set(runs.map((r) => r.run_type))].sort(),
    [runs],
  );

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => {
      if (jobFilter && run.job_id !== jobFilter) return false;
      if (statusFilter !== ALL && run.status !== statusFilter) return false;
      if (typeFilter !== ALL && run.run_type !== typeFilter) return false;
      if (marketFilter !== ALL && run.market_key !== marketFilter) return false;
      return true;
    });
  }, [runs, jobFilter, statusFilter, typeFilter, marketFilter]);

  const repairStaleRuns = async () => {
    setRepairing(true);
    try {
      const res = await fetch("/api/runs/repair", { method: "POST" });
      const data = (await res.json()) as { repaired?: number; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Repair failed");
        return;
      }
      toast.success(`Repaired ${data.repaired ?? 0} stale runs`);
      refreshRuns();
    } finally {
      setRepairing(false);
    }
  };

  const shortCommand = (command: string) => {
    const idx = command.indexOf("run-campaign");
    if (idx >= 0) return command.slice(idx);
    const runIdx = command.indexOf(" run ");
    if (runIdx >= 0) return command.slice(runIdx + 1);
    return command.length > 72 ? `${command.slice(0, 72)}…` : command;
  };

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6">
        <div className="pointer-events-none absolute right-0 top-0 h-24 w-40 md:h-28 md:w-52 [mask-image:linear-gradient(to_left,black_55%,transparent_100%)]">
          <ASCIIAnimation
            frameFolder="wave"
            frameCount={300}
            quality="medium"
            fps={18}
            className="h-full w-full"
            gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
            lazy
            ariaLabel="Wave animation"
          />
        </div>
        <div className="relative max-w-2xl">
          <SectionHeading index="01" title="Run Analytics" />
          <PageHeader description="Local executions and their market cells — launch new work from Launch." />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <TypedText text="PIPELINE RUNS — view and analyze" />
        {hasRunning ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <AsciiSpinner />
            Auto-refresh
          </span>
        ) : null}
      </div>

      {liveJobs.length > 0 || jobFilter ? (
        <SectionReveal>
          <Card className="panel" data-testid="local-executions">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.14em]">
                <Terminal className="size-4" />
                Local executions
              </CardTitle>
              <CardDescription>
                Parent Launch jobs. Each row below is a market×category cell under a job.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {liveJobs.length === 0 && jobFilter ? (
                <p className="text-sm text-muted-foreground">
                  Filtering cells for job{" "}
                  <span className="font-mono text-xs">{jobFilter.slice(0, 8)}…</span>
                  {" · "}
                  <button
                    type="button"
                    className="text-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      setJobFilter(null);
                      router.replace("/runs");
                    }}
                  >
                    Clear filter
                  </button>
                </p>
              ) : null}
              {liveJobs.map((job) => {
                const active = jobFilter === job.id;
                return (
                  <div
                    key={job.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5",
                      active
                        ? "border-primary/40 bg-primary/5"
                        : "border-border/60 bg-background/40",
                    )}
                  >
                    <Badge variant="outline" className="font-mono text-[10px] uppercase">
                      {job.status}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[11px] text-foreground/90">
                        {shortCommand(job.command)}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {[job.market, job.category].filter(Boolean).join(" / ") || "starting…"}
                        {job.runId ? ` · ${job.runId.slice(0, 8)}…` : ""}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={active ? "secondary" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => {
                        setJobFilter(job.id);
                        router.replace(`/runs?job=${encodeURIComponent(job.id)}`);
                      }}
                    >
                      Cells
                    </Button>
                    {job.runId ? (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                        <Link href={`/runs/${encodeURIComponent(job.runId)}`}>Studio</Link>
                      </Button>
                    ) : null}
                    <CancelJobButton
                      jobId={job.id}
                      visible={job.status === "running" || job.status === "pending"}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </SectionReveal>
      ) : null}

      <SectionReveal>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total runs" value={analytics.total} icon={Database} />
          <StatCard
            label="Completed"
            value={analytics.completed}
            sub={`${formatPct(analytics.completedRate)} completed`}
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="Running"
            value={analytics.running}
            sub={`${liveJobs.length} local job${liveJobs.length === 1 ? "" : "s"}`}
            icon={Activity}
            tone={analytics.running > 0 ? "warning" : "default"}
          />
          <StatCard
            label="Failed"
            value={analytics.failed}
            icon={AlertTriangle}
            tone={analytics.failed > 0 ? "warning" : "default"}
          />
          <StatCard label="Discovered" value={analytics.discovered} icon={Search} />
          <StatCard label="Completed" value={analytics.enriched} icon={CheckCircle2} tone="success" />
        </div>
      </SectionReveal>

      <Card className="panel min-w-0">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Run history</CardTitle>
            <CardDescription>
              Persisted market cells from the lead database. Click a row for Pipeline Studio.
              {jobFilter ? " Showing cells for the selected local execution." : null}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All types</SelectItem>
                  {runTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Market</Label>
              <Select value={marketFilter} onValueChange={setMarketFilter}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All markets</SelectItem>
                  {config.markets.map((m) => (
                    <SelectItem key={m.key} value={m.key}>
                      {m.city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {jobFilter ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setJobFilter(null);
                  router.replace("/runs");
                }}
              >
                Clear job filter
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void repairStaleRuns()}
              disabled={repairing}
            >
              {repairing ? <AsciiSpinner className="text-sm" /> : <Wrench className="size-3.5" />}
              Repair stale runs
            </Button>
            <Button variant="ghost" size="sm" onClick={refreshRuns}>
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {runs.length === 0 ? "No runs in database yet." : "No runs match the current filters."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-card/40 hover:bg-card/40">
                  <TableHead>Status</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Market / Category</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Discovered</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Skipped</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Completed</TableHead>
                  <TableHead className="whitespace-nowrap">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRuns.map((run) => (
                  <TableRow
                    key={run.run_id}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-accent",
                      jobFilter && run.job_id === jobFilter && "bg-primary/5",
                    )}
                    onClick={() => router.push(`/runs/${encodeURIComponent(run.run_id)}`)}
                  >
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RunStatusBadge status={run.status} />
                        <StopReasonBadge
                          reason={run.stop_reason}
                          detail={run.stop_detail}
                          status={run.status}
                          discoveredCount={run.discovered_count}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.run_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {run.campaign_key ? (
                        <span className="text-muted-foreground">{run.campaign_key} · </span>
                      ) : null}
                      {run.market_key ?? "—"}
                      {run.category_key ? (
                        <span className="text-muted-foreground"> / {run.category_key}</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.discovered_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {run.skipped_known_count}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {run.enriched_count}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {run.started_at.slice(0, 16).replace("T", " ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
