"use client";

import { memo, useCallback, useDeferredValue, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { CheckCircle2, Phone, RotateCcw, Search, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { ScoreBadge, SalesStatusBadge, VerificationBadge } from "@/components/badges";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CRM_STATUSES, type CrmStatus, type LeadRow, type PipelineConfig } from "@/lib/types";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

const ALL = "__all__";
export type WorkspaceTab = "all" | "client" | "vendor" | "triage";

const STATUS_TONE: Record<CrmStatus, string> = {
  New: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Contacted: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "Follow Up": "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  Interested: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  "Quote Sent": "bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400",
  Won: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  Lost: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  "Bad Data": "bg-red-500/15 text-red-600 dark:text-red-400",
};

function normalizeTab(tab: string | null | undefined): WorkspaceTab {
  if (tab === "client" || tab === "vendor" || tab === "triage" || tab === "all") {
    return tab;
  }
  return "all";
}

function isTriageLead(lead: LeadRow): boolean {
  if ((lead.lead_score ?? 0) < 40) return true;
  if (lead.verification_level === "unverified") return true;
  if (lead.enrichment_status === "needs_manual") return true;
  if (lead.confidence === "Low") return true;
  return false;
}

function triageReason(lead: LeadRow): string {
  if ((lead.lead_score ?? 0) < 40) return "Low score";
  if (lead.verification_level === "unverified") return "Unverified contact";
  if (lead.enrichment_status === "needs_manual") return "Needs manual review";
  if (lead.confidence === "Low") return "Low confidence";
  return "Needs attention";
}

function formatPhoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits || phone}`;
}

type LeadListRowProps = {
  lead: LeadRow;
  tab: WorkspaceTab;
  selected: boolean;
  categoryLabel: string;
  marketLabel: string;
  onSelect: (placeId: string, checked: boolean) => void;
  onOpenDetail: (placeId: string) => void;
  onSetStatus: (placeId: string, status: CrmStatus) => void;
  onSetAddressed: (placeId: string, addressed: boolean) => void;
};

const LeadListRow = memo(function LeadListRow({
  lead,
  tab,
  selected,
  categoryLabel,
  marketLabel,
  onSelect,
  onOpenDetail,
  onSetStatus,
  onSetAddressed,
}: LeadListRowProps) {
  const detailLabel = tab === "triage" ? triageReason(lead) : lead.status;

  return (
    <div
      className={cn(
        "grid gap-3 rounded-lg border border-border bg-card px-3 py-3 shadow-sm md:grid-cols-[2rem_minmax(18rem,1.7fr)_12.5rem_minmax(12rem,auto)_10rem_4rem] md:items-center md:rounded-none md:border-x-0 md:border-t-0 md:bg-transparent md:px-4 md:shadow-none md:last:border-b-0",
        selected && "bg-primary/5",
        lead.addressed && "opacity-70",
      )}
    >
      <div className="flex items-center md:justify-center">
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(lead.place_id, v === true)}
          aria-label={`Select ${lead.business_name}`}
        />
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(lead.place_id)}
        className="min-w-0 text-left"
      >
        <span className="block truncate text-sm font-semibold leading-5">
          {lead.business_name}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{lead.city ?? "No city"}</span>
          <span aria-hidden>|</span>
          <span>{marketLabel}</span>
          <span aria-hidden>|</span>
          <span className="max-w-full truncate">{categoryLabel}</span>
          <Badge
            variant={lead.lead_type === "vendor" ? "secondary" : "outline"}
            className="h-5 px-1.5 text-[10px]"
          >
            {lead.lead_type === "vendor" ? "Vendor" : "Client"}
          </Badge>
        </span>
      </button>

      <div className="min-w-0">
        {lead.phone ? (
          <a
            href={formatPhoneHref(lead.phone)}
            className="inline-flex min-h-10 w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 font-mono text-sm tabular-nums text-foreground hover:border-primary/40 hover:bg-accent md:min-h-8"
          >
            <Phone className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{lead.phone}</span>
          </a>
        ) : (
          <button
            type="button"
            onClick={() => onOpenDetail(lead.place_id)}
            className="inline-flex min-h-10 w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 text-sm text-muted-foreground md:min-h-8"
          >
            <Phone className="size-3.5" />
            No phone
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => onOpenDetail(lead.place_id)}
        className="flex min-w-0 flex-wrap items-center gap-2 text-left"
      >
        <ScoreBadge score={lead.lead_score} />
        <VerificationBadge level={lead.verification_level} />
        {tab === "triage" ? (
          <Badge variant="outline" className="max-w-full truncate">
            {detailLabel}
          </Badge>
        ) : (
          <SalesStatusBadge status={detailLabel} />
        )}
      </button>

      <div>
        <Select
          value={lead.crm_status}
          onValueChange={(v) => void onSetStatus(lead.place_id, v as CrmStatus)}
        >
          <SelectTrigger
            size="sm"
            className={cn(
              "h-8 w-full min-w-36 border-0 text-xs font-medium",
              STATUS_TONE[lead.crm_status],
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRM_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2 md:justify-center">
        <Checkbox
          checked={lead.addressed}
          onCheckedChange={(v) => void onSetAddressed(lead.place_id, v === true)}
          aria-label={`Mark ${lead.business_name} done`}
        />
        <span className="text-xs text-muted-foreground md:hidden">Done</span>
      </div>
    </div>
  );
});

export function WorkspaceClient({
  initialLeads,
  config,
  initialTab,
  initialPlaceId,
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
  initialTab?: WorkspaceTab;
  initialPlaceId?: string | null;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [tab, setTab] = useState<WorkspaceTab>(() => normalizeTab(initialTab));
  const [market, setMarket] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [salesStatus, setSalesStatus] = useState(ALL);
  const [crmStatus, setCrmStatus] = useState(ALL);
  const [minScore, setMinScore] = useState(0);
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailId, setDetailId] = useState<string | null>(initialPlaceId ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<CrmStatus>("Contacted");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const categoryLabelMap = useMemo(
    () => new Map(config.categories.map((c) => [c.key, c.label])),
    [config.categories],
  );

  const marketLabelMap = useMemo(
    () => new Map(config.markets.map((m) => [m.key, m.city])),
    [config.markets],
  );

  const tabCounts = useMemo(
    () => ({
      all: leads.length,
      client: leads.filter((l) => l.lead_type === "client").length,
      vendor: leads.filter((l) => l.lead_type === "vendor").length,
      triage: leads.filter(isTriageLead).length,
    }),
    [leads],
  );

  const filtered = useMemo(() => {
    let rows = leads;
    if (tab === "client") rows = rows.filter((l) => l.lead_type === "client");
    else if (tab === "vendor") rows = rows.filter((l) => l.lead_type === "vendor");
    else if (tab === "triage") rows = rows.filter(isTriageLead);
    if (market !== ALL) rows = rows.filter((l) => l.market_key === market);
    if (category !== ALL) rows = rows.filter((l) => l.category_key === category);
    if (salesStatus !== ALL) rows = rows.filter((l) => l.status === salesStatus);
    if (crmStatus !== ALL) rows = rows.filter((l) => l.crm_status === crmStatus);
    if (minScore > 0) rows = rows.filter((l) => (l.lead_score ?? 0) >= minScore);
    if (hideDone) rows = rows.filter((l) => !l.addressed);
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (l) =>
          l.business_name.toLowerCase().includes(q) ||
          (l.city ?? "").toLowerCase().includes(q) ||
          (l.market_key ?? "").toLowerCase().includes(q) ||
          (l.category_key ?? "").toLowerCase().includes(q) ||
          (l.phone ?? "").includes(q),
      );
    }
    return rows;
  }, [
    leads,
    tab,
    market,
    category,
    salesStatus,
    crmStatus,
    minScore,
    hideDone,
    deferredSearch,
  ]);

  const visibleIds = useMemo(() => filtered.map((l) => l.place_id), [filtered]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const hasSelection = selected.size > 0;
  const activeFilterCount = [
    market !== ALL,
    category !== ALL,
    salesStatus !== ALL,
    crmStatus !== ALL,
    minScore > 0,
    hideDone,
  ].filter(Boolean).length;

  const patchLead = useCallback(
    async (placeId: string, body: { status?: CrmStatus; addressed?: boolean }) => {
      const res = await fetch(`/api/leads/${encodeURIComponent(placeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.error("Failed to save lead");
        return false;
      }
      return true;
    },
    [],
  );

  const setStatus = useCallback(
    async (placeId: string, status: CrmStatus) => {
      setLeads((prev) =>
        prev.map((l) => (l.place_id === placeId ? { ...l, crm_status: status } : l)),
      );
      await patchLead(placeId, { status });
    },
    [patchLead],
  );

  const setAddressed = useCallback(
    async (placeId: string, addressed: boolean) => {
      setLeads((prev) =>
        prev.map((l) => (l.place_id === placeId ? { ...l, addressed } : l)),
      );
      await patchLead(placeId, { addressed });
    },
    [patchLead],
  );

  const toggleSelect = useCallback((placeId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(placeId);
      else next.delete(placeId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) setSelected(new Set(visibleIds));
      else setSelected(new Set());
    },
    [visibleIds],
  );

  const openDetail = useCallback((placeId: string) => {
    setDetailId(placeId);
  }, []);

  const resetFilters = useCallback(() => {
    setMarket(ALL);
    setCategory(ALL);
    setSalesStatus(ALL);
    setCrmStatus(ALL);
    setMinScore(0);
    setHideDone(false);
  }, []);

  const renderFilterControls = (idPrefix: string) => (
    <>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Market</Label>
        <Select value={market} onValueChange={setMarket}>
          <SelectTrigger className="w-full md:w-40">
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
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Category</Label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full md:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {config.categories.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Sales status</Label>
        <Select value={salesStatus} onValueChange={setSalesStatus}>
          <SelectTrigger className="w-full md:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All</SelectItem>
            <SelectItem value="Ready to call">Ready to call</SelectItem>
            <SelectItem value="Needs research">Needs research</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">CRM status</Label>
        <Select value={crmStatus} onValueChange={setCrmStatus}>
          <SelectTrigger className="w-full md:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {CRM_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5 md:w-44">
        <Label className="flex items-center gap-1 text-xs text-muted-foreground">
          <SlidersHorizontal className="size-3" />
          Min score: <span className="font-semibold tabular-nums">{minScore}</span>
        </Label>
        <Slider
          min={0}
          max={100}
          step={5}
          value={[minScore]}
          onValueChange={([v]) => setMinScore(v)}
        />
      </div>
      <div className="flex items-center gap-2 pb-0.5">
        <Switch
          id={`${idPrefix}-hide-done`}
          checked={hideDone}
          onCheckedChange={setHideDone}
        />
        <Label htmlFor={`${idPrefix}-hide-done`} className="text-xs text-muted-foreground">
          Hide done
        </Label>
      </div>
    </>
  );

  const bulkSetStatus = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setLeads((prev) =>
      prev.map((l) => (selected.has(l.place_id) ? { ...l, crm_status: bulkStatus } : l)),
    );
    const results = await Promise.all(ids.map((id) => patchLead(id, { status: bulkStatus })));
    if (results.every(Boolean)) toast.success(`Updated ${ids.length} leads`);
    setSelected(new Set());
  };

  const bulkSetDone = async (addressed: boolean) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setLeads((prev) =>
      prev.map((l) => (selected.has(l.place_id) ? { ...l, addressed } : l)),
    );
    const results = await Promise.all(ids.map((id) => patchLead(id, { addressed })));
    if (results.every(Boolean)) {
      toast.success(`Marked ${ids.length} leads ${addressed ? "done" : "not done"}`);
    }
    setSelected(new Set());
  };

  return (
    <div className={cn("space-y-6", hasSelection && "pb-40 md:pb-0")}>
      <PageHeader description="Work callable leads in one place: filter, triage, set CRM status, and mark done as you go." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as WorkspaceTab)}>
        <TabsList className="w-full justify-start sm:w-fit">
          <TabsTrigger value="all">All ({tabCounts.all})</TabsTrigger>
          <TabsTrigger value="client">Clients ({tabCounts.client})</TabsTrigger>
          <TabsTrigger value="vendor">Vendors ({tabCounts.vendor})</TabsTrigger>
          <TabsTrigger value="triage">Triage ({tabCounts.triage})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="sticky top-14 z-10 md:hidden">
        <CardContent className="flex items-center gap-2 py-3">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-11 pl-8"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 gap-1.5 px-3"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal className="size-4" />
            <span className="sr-only">Open filters</span>
            {activeFilterCount > 0 ? (
              <Badge variant="secondary" className="h-5 min-w-5 px-1 text-[10px]">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>
        </CardContent>
      </Card>

      <Card className="sticky top-14 z-10 hidden md:block">
        <CardContent className="flex flex-wrap items-end gap-4 py-5">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search business, city, market, category, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {renderFilterControls("desktop")}
          {activeFilterCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] overflow-y-auto rounded-t-xl p-0"
        >
          <SheetHeader className="border-b border-border px-4 py-3 text-left">
            <SheetTitle>Filters</SheetTitle>
            <SheetDescription>
              Narrow the lead list without losing your current search.
            </SheetDescription>
          </SheetHeader>
          <div className="grid gap-4 px-4 py-4">{renderFilterControls("mobile")}</div>
          <div className="sticky bottom-0 grid grid-cols-2 gap-2 border-t border-border bg-card/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur">
            <Button type="button" variant="outline" className="h-11" onClick={resetFilters}>
              Reset
            </Button>
            <Button type="button" className="h-11" onClick={() => setFiltersOpen(false)}>
              Apply
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Card className="overflow-hidden py-0">
        <CardHeader className="gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(v) => toggleSelectAll(v === true)}
              aria-label="Select all visible leads"
            />
            <div className="min-w-0">
              <CardTitle className="text-sm">Leads</CardTitle>
              <CardDescription>
                {filtered.length.toLocaleString()} visible of {leads.length.toLocaleString()} leads
              </CardDescription>
            </div>
          </div>

          <div className="hidden min-h-9 flex-wrap items-center gap-2 md:flex">
            <span
              className={cn(
                "min-w-24 text-sm font-medium",
                hasSelection ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {hasSelection ? `${selected.size} selected` : "No selection"}
            </span>
            <Select
              value={bulkStatus}
              disabled={!hasSelection}
              onValueChange={(v) => setBulkStatus(v as CrmStatus)}
            >
              <SelectTrigger size="sm" className="h-8 w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CRM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={!hasSelection}
              onClick={() => void bulkSetStatus()}
            >
              Set status
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!hasSelection}
              onClick={() => void bulkSetDone(true)}
            >
              <CheckCircle2 className="size-3.5" />
              Done
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!hasSelection}
              onClick={() => void bulkSetDone(false)}
            >
              <RotateCcw className="size-3.5" />
              Not done
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!hasSelection}
              onClick={() => setSelected(new Set())}
            >
              <X className="size-3.5" />
              Clear
            </Button>
          </div>
        </CardHeader>

        <div className="hidden border-b border-border bg-muted/35 px-4 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[2rem_minmax(18rem,1.7fr)_12.5rem_minmax(12rem,auto)_10rem_4rem]">
          <span />
          <span>Business</span>
          <span>Phone</span>
          <span>Score / verification</span>
          <span>CRM status</span>
          <span className="text-center">Done</span>
        </div>

        <div className="space-y-3 p-3 md:space-y-0 md:p-0">
          {filtered.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              No leads match these filters.
            </div>
          ) : (
            filtered.map((lead) => (
              <LeadListRow
                key={lead.place_id}
                lead={lead}
                tab={tab}
                selected={selected.has(lead.place_id)}
                categoryLabel={
                  categoryLabelMap.get(lead.category_key ?? "") ?? lead.category_key ?? "No category"
                }
                marketLabel={
                  marketLabelMap.get(lead.market_key ?? "") ?? lead.market_key ?? "No market"
                }
                onSelect={toggleSelect}
                onOpenDetail={openDetail}
                onSetStatus={setStatus}
                onSetAddressed={setAddressed}
              />
            ))
          )}
        </div>
      </Card>

      {hasSelection ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(15,23,42,0.16)] backdrop-blur md:hidden">
          <div className="mx-auto max-w-md space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{selected.size} selected</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={() => setSelected(new Set())}
              >
                <X className="size-4" />
                Clear
              </Button>
            </div>
            <div className="grid gap-2">
              <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as CrmStatus)}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CRM_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-3 gap-2">
                <Button className="h-11" onClick={() => void bulkSetStatus()}>
                  Set
                </Button>
                <Button
                  className="h-11"
                  variant="secondary"
                  onClick={() => void bulkSetDone(true)}
                >
                  Done
                </Button>
                <Button
                  className="h-11"
                  variant="outline"
                  onClick={() => void bulkSetDone(false)}
                >
                  Undo
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
