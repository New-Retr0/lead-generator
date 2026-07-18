"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Building2,
  ChevronDown,
  Coins,
  MapPin,
  Route,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { AnimatedNumber } from "@/components/animated";
import { ChipSelect } from "@/components/chip-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import type { RequestCreditBudget } from "@/lib/request-budget";
import {
  estimateRequestCost,
  type PipelineConfig,
  type RequestSpec,
} from "@/lib/types";

export function RequestsBuilder({
  config,
  requestBudget,
  onJobStarted,
}: {
  config: PipelineConfig;
  requestBudget: RequestCreditBudget;
  onJobStarted: (jobId: string) => void;
}) {
  const [count, setCount] = useState(5);
  const [targetKind, setTargetKind] = useState<"property" | "vendor">("property");
  const [markets, setMarkets] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [requireDM, setRequireDM] = useState(true);
  const [corridorOpen, setCorridorOpen] = useState(false);
  const [corridorRoad, setCorridorRoad] = useState("");
  const [corridorBuffer, setCorridorBuffer] = useState(800);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const spec: RequestSpec = useMemo(
    () => ({
      target_kind: targetKind,
      count,
      categories,
      market_keys: markets,
      corridor:
        corridorOpen && corridorRoad.trim()
          ? { road_ref: corridorRoad.trim(), buffer_m: corridorBuffer }
          : null,
      require_decision_maker: requireDM,
      recurring_only: false,
      min_lead_score: 0,
      budget: { max_firecrawl_credits: requestBudget.maxFirecrawlCredits },
      needs_confirmation: [],
    }),
    [
      targetKind,
      count,
      categories,
      markets,
      corridorOpen,
      corridorRoad,
      corridorBuffer,
      requireDM,
      requestBudget.maxFirecrawlCredits,
    ],
  );

  const estimate = useMemo(
    () => estimateRequestCost(spec, requestBudget.firecrawlCreditUsd),
    [spec, requestBudget.firecrawlCreditUsd],
  );
  const builderValid = markets.length > 0 && categories.length > 0 && count >= 1;
  const planLabel =
    requestBudget.firecrawlPlanName ??
    (requestBudget.source === "live" ? "current plan" : "configured plan");

  const submit = async (body: Record<string, unknown>, dryRun: boolean) => {
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/jobs/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to start request");
        return;
      }
      onJobStarted(data.jobId);
      toast.success(dryRun ? "Estimating request..." : "Request started", {
        description: dryRun
          ? "Parsing and pricing only - no credits spent."
          : "Watch the job log for progress.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const marketOptions = config.markets.map((m) => ({
    value: m.key,
    label: m.city,
    hint: m.county ?? undefined,
  }));
  const categoryOptions = config.categories.map((c) => ({
    value: c.key,
    label: c.label,
    hint: c.recurring ? "Recurring-friendly" : undefined,
  }));

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_300px]">
      <Tabs defaultValue="builder" className="min-w-0">
        <TabsList>
          <TabsTrigger value="builder">
            <Wand2 className="size-3.5" />
            Builder
          </TabsTrigger>
          <TabsTrigger value="nl">
            <Sparkles className="size-3.5" />
            Natural language
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder">
          <Card className="panel hover-lift">
            <CardHeader>
              <CardTitle>Lead request</CardTitle>
              <CardDescription>
                Build a focused batch of callable decision-maker leads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label htmlFor="count">Number of leads</Label>
                    </TooltipTrigger>
                    <TooltipContent>Target batch size.</TooltipContent>
                  </Tooltip>
                  <Input
                    id="count"
                    type="number"
                    min={1}
                    max={500}
                    value={count}
                    onChange={(e) =>
                      setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label>Target type</Label>
                    </TooltipTrigger>
                    <TooltipContent>Client or vendor.</TooltipContent>
                  </Tooltip>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={targetKind}
                    onValueChange={(v) =>
                      v && setTargetKind(v as "property" | "vendor")
                    }
                    className="w-full"
                  >
                    <ToggleGroupItem value="property" className="flex-1">
                      <Building2 className="size-3.5" />
                      Properties
                    </ToggleGroupItem>
                    <ToggleGroupItem value="vendor" className="flex-1">
                      Vendors
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="flex items-center gap-1.5">
                        <MapPin className="size-3.5 text-muted-foreground" />
                        Markets
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent>Where to search.</TooltipContent>
                  </Tooltip>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setMarkets(config.markets.map((m) => m.key))}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:underline"
                      onClick={() => setMarkets([])}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <ChipSelect
                  options={marketOptions}
                  selected={markets}
                  onChange={setMarkets}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Label className="flex items-center gap-1.5">
                        <Building2 className="size-3.5 text-muted-foreground" />
                        Property categories
                      </Label>
                    </TooltipTrigger>
                    <TooltipContent>What to find.</TooltipContent>
                  </Tooltip>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setCategories(config.categories.map((c) => c.key))}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:underline"
                      onClick={() => setCategories([])}
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <ChipSelect
                  options={categoryOptions}
                  selected={categories}
                  onChange={setCategories}
                />
              </div>

              <Separator />

              <label className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                <div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-sm font-medium">Decision-maker contact</p>
                    </TooltipTrigger>
                    <TooltipContent>Require callable owner/PM.</TooltipContent>
                  </Tooltip>
                  <p className="text-xs text-muted-foreground">
                    Require a callable right-person contact.
                  </p>
                </div>
                <Switch checked={requireDM} onCheckedChange={setRequireDM} />
              </label>

              <Collapsible open={corridorOpen} onOpenChange={setCorridorOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="-ml-2 gap-1.5">
                        <Route className="size-3.5" />
                        Corridor filter
                        <ChevronDown
                          className={`size-3.5 transition-transform ${corridorOpen ? "rotate-180" : ""}`}
                        />
                      </Button>
                    </CollapsibleTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Near road/highway.</TooltipContent>
                </Tooltip>
                <CollapsibleContent>
                  <div className="mt-2 grid gap-4 rounded-lg border bg-secondary/40 p-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="road">Road / highway</Label>
                      <Input
                        id="road"
                        placeholder="e.g. CA-99"
                        value={corridorRoad}
                        onChange={(e) => setCorridorRoad(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="buffer">Buffer (meters)</Label>
                      <Input
                        id="buffer"
                        type="number"
                        min={100}
                        step={100}
                        value={corridorBuffer}
                        onChange={(e) =>
                          setCorridorBuffer(Number(e.target.value) || 800)
                        }
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="lg"
                        disabled={!builderValid || submitting}
                        onClick={() => void submit({ spec }, false)}
                      >
                        <Sparkles className="size-4" />
                        Run request
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Start request job.</TooltipContent>
                </Tooltip>
                {!builderValid ? (
                  <p className="text-xs text-muted-foreground">
                    Pick at least one market and one category.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="nl">
          <Card className="panel hover-lift">
            <CardHeader>
              <CardTitle>Natural language request</CardTitle>
              <CardDescription>
                Parse a prompt into a structured lead request before running it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder='e.g. "10 strip malls and shopping centers in Fresno and Visalia along CA-99, decision-maker contacts only"'
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!prompt.trim() || submitting}
                  onClick={() => void submit({ prompt }, true)}
                >
                  Parse &amp; estimate
                </Button>
                <Button
                  disabled={!prompt.trim() || submitting}
                  onClick={() => void submit({ prompt }, false)}
                >
                  <Sparkles className="size-4" />
                  Run request
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="space-y-4 lg:pt-11">
        <motion.div
          layout
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          <Card
            className="panel panel-sheen border-primary/25 bg-gradient-to-b from-primary/[0.08] to-transparent"
            data-testid="request-estimate"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Coins className="size-4 text-primary" />
                Live cost estimate
              </CardTitle>
              <CardDescription>
                Updates as lead count, markets, and categories change.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Total credits</span>
                <span className="text-2xl font-bold tabular-nums">
                  <AnimatedNumber value={estimate.totalCredits} />
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">USD equivalent</span>
                <span className="text-2xl font-bold tabular-nums text-primary">
                  <AnimatedNumber
                    value={estimate.usd}
                    format={(n) => `$${n.toFixed(2)}`}
                  />
                </span>
              </div>
              <Separator />
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>
                    Places search ({markets.length || 0} x {categories.length || 0} combos)
                  </span>
                  <span className="tabular-nums">{estimate.discoveryCredits} cr</span>
                </div>
                <div className="flex justify-between">
                  <span>Per-place processing ({count} x 13)</span>
                  <span className="tabular-nums">{estimate.enrichCredits} cr</span>
                </div>
                <div className="flex justify-between">
                  <span>Request cap</span>
                  <span className="tabular-nums">
                    {requestBudget.maxFirecrawlCredits.toLocaleString()} cr
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Plan</span>
                  <span className="tabular-nums">{planLabel}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
