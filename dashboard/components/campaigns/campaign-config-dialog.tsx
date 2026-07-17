"use client";

import { Save } from "lucide-react";
import { ChipSelect } from "@/components/chip-select";
import {
  EstimateBreakdown,
  type EstimateBreakdownData,
  type FirecrawlEstimateBalance,
} from "@/components/campaigns/estimate-breakdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Market = { key: string; city: string; state: string };

export type CampaignConfigState = {
  selectedMarkets: string[];
  selectedCategories: string[];
  limit: number;
  discoverOnly: boolean;
  maxCreditsPerRun: number | "";
};

type CampaignConfigDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stateKey: string;
  stateLabel: string;
  stateName: string;
  markets: Market[];
  categories: string[];
  config: CampaignConfigState;
  estimate: EstimateBreakdownData | null;
  firecrawlBalance?: FirecrawlEstimateBalance | null;
  launching: boolean;
  onChange: (patch: Partial<CampaignConfigState>) => void;
  onSaveToLaunchControl: () => void;
};

export function CampaignConfigDialog({
  open,
  onOpenChange,
  stateKey,
  stateLabel,
  stateName,
  markets,
  categories,
  config,
  estimate,
  firecrawlBalance,
  launching,
  onChange,
  onSaveToLaunchControl,
}: CampaignConfigDialogProps) {
  const allSelected = config.selectedMarkets.length === markets.length;
  const runnable =
    config.selectedMarkets.length > 0 &&
    config.selectedCategories.length > 0 &&
    config.limit >= 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-4 flex h-[calc(100dvh-2rem)] max-h-[calc(100dvh-2rem)] translate-y-0 flex-col overflow-hidden sm:top-8 sm:h-[calc(100dvh-4rem)] sm:max-h-[calc(100dvh-4rem)] sm:max-w-5xl">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>
            {stateLabel} - {stateName}
          </DialogTitle>
          <DialogDescription>
            Configure markets, categories, and limits for {stateKey}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 md:grid-cols-[minmax(260px,0.9fr)_minmax(320px,1.1fr)]">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">Markets</Label>
              <div className="flex gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-[10px] text-primary hover:underline"
                      onClick={() => onChange({ selectedMarkets: markets.map((m) => m.key) })}
                    >
                      Select all
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Select all markets.</TooltipContent>
                </Tooltip>
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:underline"
                  onClick={() => onChange({ selectedMarkets: [] })}
                >
                  None
                </button>
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/40 p-2">
              {markets.map((market) => (
                <label
                  key={market.key}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={config.selectedMarkets.includes(market.key)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...config.selectedMarkets, market.key]
                        : config.selectedMarkets.filter((k) => k !== market.key);
                      onChange({ selectedMarkets: next });
                    }}
                    className="size-3.5 rounded border-border accent-primary"
                  />
                  <span>
                    {market.city}, {market.state}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">{market.key}</span>
                </label>
              ))}
            </div>
            <p className="font-mono text-[10px] text-muted-foreground">
              {config.selectedMarkets.length} of {markets.length} selected
              {allSelected ? " (all)" : ""}
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">Categories</Label>
            <ChipSelect
              options={categories.map((cat) => ({
                value: cat,
                label: cat.replace(/_/g, " "),
              }))}
              selected={config.selectedCategories}
              onChange={(selectedCategories) => onChange({ selectedCategories })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3 md:col-span-2">
            <div className="space-y-2">
              <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">Lead limit</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={config.limit}
                onChange={(e) =>
                  onChange({ limit: Math.max(1, Number(e.target.value) || 20) })
                }
                className="font-mono tabular-nums"
              />
            </div>
            <div className="space-y-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Label className="font-mono text-[10px] uppercase tracking-[0.12em]">
                    Max credits / run
                  </Label>
                </TooltipTrigger>
                <TooltipContent>Per-run credit cap.</TooltipContent>
              </Tooltip>
              <Input
                type="number"
                min={1}
                placeholder="auto"
                value={config.maxCreditsPerRun}
                onChange={(e) => {
                  const raw = e.target.value;
                  onChange({
                    maxCreditsPerRun:
                      raw === "" ? "" : Math.max(1, Math.floor(Number(raw) || 0)),
                  });
                }}
                className="font-mono tabular-nums"
              />
            </div>
            <div className="flex flex-col justify-end gap-2 rounded-lg border border-border/40 px-3 py-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Label htmlFor="discover-only" className="text-xs">
                    Discovery only
                  </Label>
                </TooltipTrigger>
                <TooltipContent>No enrichment spend.</TooltipContent>
              </Tooltip>
              <Switch
                id="discover-only"
                checked={config.discoverOnly}
                onCheckedChange={(discoverOnly) => onChange({ discoverOnly })}
              />
            </div>
          </div>

          <div className="min-h-[12rem] rounded-lg border border-border/40 bg-muted/20 px-3 py-3 md:col-span-2">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Estimate
            </p>
            <EstimateBreakdown estimate={estimate} firecrawlBalance={firecrawlBalance} />
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:gap-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  disabled={launching || !runnable}
                  onClick={onSaveToLaunchControl}
                >
                  <Save className="size-3.5" />
                  Save to Launch Control
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Stage, do not launch.</TooltipContent>
          </Tooltip>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
