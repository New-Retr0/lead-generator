"use client";

import { useState } from "react";
import { Send, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { PipelineConfig } from "@/lib/types";

async function enqueue(kind: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, payload }),
  });
  const body = (await res.json()) as { id?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? "Failed to enqueue job");
  return body.id;
}

export function RunControlsCard({
  config,
  realtimeEnabled,
  onRealtimeChange,
  reducedMotion,
  onReducedMotionChange,
  onRunQueued,
}: {
  config: PipelineConfig;
  realtimeEnabled: boolean;
  onRealtimeChange: (v: boolean) => void;
  reducedMotion: boolean;
  onReducedMotionChange: (v: boolean) => void;
  onRunQueued?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [market, setMarket] = useState(config.markets[0]?.key ?? "");
  const [category, setCategory] = useState(config.categories[0]?.key ?? "");
  const [limit, setLimit] = useState("3");
  const [discoverOnly, setDiscoverOnly] = useState(false);
  const [noSkipKnown, setNoSkipKnown] = useState(false);
  const [browserUse, setBrowserUse] = useState(true);
  const [ownerChainBackend, setOwnerChainBackend] = useState("browser_use");
  const [parallelWorkers, setParallelWorkers] = useState("4");
  const [creditCap, setCreditCap] = useState("");
  const [aiOwnerDisambiguation, setAiOwnerDisambiguation] = useState(true);
  const [aiNeedSignalFallback, setAiNeedSignalFallback] = useState(false);
  const [aiGatewayEnabled, setAiGatewayEnabled] = useState(true);

  async function launchRun() {
    setLoading(true);
    try {
      const env_overrides: Record<string, string | number | boolean> = {
        BROWSER_USE_ENABLED: browserUse,
        OWNER_CHAIN_BACKEND: ownerChainBackend,
        AI_GATEWAY_ENABLED: aiGatewayEnabled,
        AI_OWNER_DISAMBIGUATION: aiOwnerDisambiguation,
        AI_NEED_SIGNAL_FALLBACK: aiNeedSignalFallback,
      };
      const workers = Number(parallelWorkers);
      if (workers > 0) env_overrides.ENRICHMENT_PARALLEL_WORKERS = workers;
      const cap = creditCap.trim();
      if (cap) {
        env_overrides.FIRECRAWL_MAX_CREDITS_PER_RUN = Number(cap);
        env_overrides.FIRECRAWL_SESSION_CREDIT_STOP = Number(cap);
      }

      await enqueue("run", {
        market,
        category,
        limit: limit.trim() ? Number(limit) : undefined,
        discover_only: discoverOnly,
        no_skip_known: noSkipKnown,
        no_sheets: true,
        env_overrides,
      });
      toast.success("Run queued — watch the canvas when the worker picks it up.");
      onRunQueued?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue run");
    } finally {
      setLoading(false);
    }
  }

  async function refreshBalances() {
    setLoading(true);
    try {
      await enqueue("doctor", {});
      toast.success("Doctor queued — balance snapshots refresh after it completes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to queue doctor");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Run controls</CardTitle>
        <CardDescription>
          Env overrides apply to worker-spawned runs only (not local CLI). Toggle realtime
          to pause Supabase subscriptions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Market</Label>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {config.markets.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {config.categories.map((c) => (
                  <SelectItem key={c.key} value={c.key}>
                    {c.label ?? c.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Limit</Label>
            <Input
              type="number"
              min={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="e.g. 3"
            />
          </div>
          <div className="space-y-2">
            <Label>Parallel workers</Label>
            <Input
              type="number"
              min={1}
              max={16}
              value={parallelWorkers}
              onChange={(e) => setParallelWorkers(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Per-run Firecrawl credit cap</Label>
          <Input
            value={creditCap}
            onChange={(e) => setCreditCap(e.target.value)}
            placeholder="Optional — FIRECRAWL_MAX_CREDITS_PER_RUN"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Owner-chain backend</Label>
            <Select value={ownerChainBackend} onValueChange={setOwnerChainBackend}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="browser_use">Browser Use</SelectItem>
                <SelectItem value="firecrawl">Firecrawl agent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <SwitchRow label="Discover only" checked={discoverOnly} onCheckedChange={setDiscoverOnly} />
          <SwitchRow label="No skip known" checked={noSkipKnown} onCheckedChange={setNoSkipKnown} />
          <SwitchRow label="Browser Use" checked={browserUse} onCheckedChange={setBrowserUse} />
          <SwitchRow
            label="AI Gateway"
            checked={aiGatewayEnabled}
            onCheckedChange={setAiGatewayEnabled}
          />
          <SwitchRow
            label="AI owner disambiguation"
            checked={aiOwnerDisambiguation}
            onCheckedChange={setAiOwnerDisambiguation}
          />
          <SwitchRow
            label="AI need-signal fallback"
            checked={aiNeedSignalFallback}
            onCheckedChange={setAiNeedSignalFallback}
          />
          <SwitchRow
            label="Realtime updates"
            checked={realtimeEnabled}
            onCheckedChange={onRealtimeChange}
          />
          <SwitchRow
            label="Reduced motion"
            checked={reducedMotion}
            onCheckedChange={onReducedMotionChange}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={loading} onClick={() => void launchRun()}>
            <Send className="size-4" />
            Launch run
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => void refreshBalances()}
          >
            <Stethoscope className="size-4" />
            Refresh balances
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      <Label className="text-xs font-normal">{label}</Label>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
