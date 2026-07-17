"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { RunStatusBadge } from "@/components/badges";
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
import type { PipelineConfig, RunRow } from "@/lib/types";
import { formatPct } from "@/lib/utils";

const ALL = "__all__";

export function RunsPageClient({
  initialRuns,
  config,
}: {
  initialRuns: RunRow[];
  config: PipelineConfig;
}) {
  const [runs, setRuns] = useState(initialRuns);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [marketFilter, setMarketFilter] = useState(ALL);
  const [repairing, setRepairing] = useState(false);
  const router = useRouter();

  const refreshRuns = useCallback(() => {
    void fetch("/api/runs", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setRuns(data.runs ?? []);
      });
  }, []);

  const hasRunning = runs.some((r) => r.status === "running");

  useEffect(() => {
    const id = window.setInterval(refreshRuns, 10_000);
    return () => window.clearInterval(id);
  }, [refreshRuns]);

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
      if (statusFilter !== ALL && run.status !== statusFilter) return false;
      if (typeFilter !== ALL && run.run_type !== typeFilter) return false;
      if (marketFilter !== ALL && run.market_key !== marketFilter) return false;
      return true;
    });
  }, [runs, statusFilter, typeFilter, marketFilter]);

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

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border">
        <ASCIIAnimation
          frameFolder="wave"
          frameCount={300}
          quality="medium"
          fps={18}
          className="absolute inset-x-0 top-0 h-20 w-full [mask-image:linear-gradient(to_bottom,black_40%,transparent_100%)]"
          gradient="linear-gradient(160deg, var(--foreground), var(--primary))"
          lazy
          ariaLabel="Wave band"
        />
        <div className="relative p-6">
          <SectionHeading index="01" title="Run Analytics" />
          <PageHeader description="View-only run history and aggregate stats — launch new runs from Requests or Campaigns." />
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
            sub="Live count"
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
          <StatCard label="Enriched" value={analytics.enriched} icon={CheckCircle2} tone="success" />
        </div>
      </SectionReveal>

      <Card className="glass min-w-0">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Run history</CardTitle>
            <CardDescription>
              Persisted runs from the lead database. Click a row for live progress and cost summary.
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
                    className="cursor-pointer transition-colors hover:bg-accent/25"
                    onClick={() => router.push(`/runs/${encodeURIComponent(run.run_id)}`)}
                  >
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{run.run_type}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">
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
