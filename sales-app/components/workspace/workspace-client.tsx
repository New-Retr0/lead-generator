"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Phone, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ScoreBadge, SalesStatusBadge, VerificationBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CRM_STATUSES, type CrmStatus, type LeadRow, type PipelineConfig } from "@/lib/types";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

const ALL = "__all__";
type WorkspaceTab = "all" | "client" | "vendor" | "triage";

const STATUS_TONE: Record<CrmStatus, string> = {
  New: "bg-sky-500/15 text-sky-500",
  Contacted: "bg-blue-500/15 text-blue-400",
  "Follow Up": "bg-amber-500/15 text-amber-500",
  Interested: "bg-violet-500/15 text-violet-400",
  "Quote Sent": "bg-fuchsia-500/15 text-fuchsia-400",
  Won: "bg-emerald-500/15 text-emerald-500",
  Lost: "bg-zinc-500/15 text-zinc-400",
  "Bad Data": "bg-red-500/15 text-red-500",
};

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

type LeadTableRowProps = {
  lead: LeadRow;
  tab: WorkspaceTab;
  selected: boolean;
  categoryLabel: string;
  onSelect: (placeId: string, checked: boolean) => void;
  onOpenDetail: (placeId: string) => void;
  onSetStatus: (placeId: string, status: CrmStatus) => void;
  onSetAddressed: (placeId: string, addressed: boolean) => void;
};

const LeadTableRow = memo(function LeadTableRow({
  lead,
  tab,
  selected,
  categoryLabel,
  onSelect,
  onOpenDetail,
  onSetStatus,
  onSetAddressed,
}: LeadTableRowProps) {
  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-accent/25"
      data-done={lead.addressed ? "true" : undefined}
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={(v) => onSelect(lead.place_id, v === true)}
          aria-label={`Select ${lead.business_name}`}
        />
      </TableCell>
      <TableCell onClick={() => onOpenDetail(lead.place_id)}>
        <p className="font-medium">{lead.business_name}</p>
        <p className="text-xs text-muted-foreground">{lead.city ?? "—"}</p>
      </TableCell>
      <TableCell onClick={() => onOpenDetail(lead.place_id)}>
        <Badge variant={lead.lead_type === "vendor" ? "secondary" : "outline"}>
          {lead.lead_type === "vendor" ? "Vendor" : "Client"}
        </Badge>
      </TableCell>
      <TableCell
        className="whitespace-nowrap text-sm text-muted-foreground"
        onClick={() => onOpenDetail(lead.place_id)}
      >
        {lead.market_key ?? "—"}
      </TableCell>
      <TableCell onClick={() => onOpenDetail(lead.place_id)}>
        <Badge variant="outline">{categoryLabel}</Badge>
      </TableCell>
      <TableCell className="text-center" onClick={() => onOpenDetail(lead.place_id)}>
        <ScoreBadge score={lead.lead_score} />
      </TableCell>
      <TableCell onClick={() => onOpenDetail(lead.place_id)}>
        <VerificationBadge level={lead.verification_level} />
      </TableCell>
      <TableCell onClick={() => onOpenDetail(lead.place_id)}>
        {lead.phone ? (
          <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
            <Phone className="size-3 text-muted-foreground" />
            {lead.phone}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell onClick={() => onOpenDetail(lead.place_id)}>
        {tab === "triage" ? (
          <Badge variant="outline">{triageReason(lead)}</Badge>
        ) : (
          <SalesStatusBadge status={lead.status} />
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Select
          value={lead.crm_status}
          onValueChange={(v) => void onSetStatus(lead.place_id, v as CrmStatus)}
        >
          <SelectTrigger
            className={`h-8 w-36 border-0 text-xs font-medium ${STATUS_TONE[lead.crm_status] ?? ""}`}
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
      </TableCell>
      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={lead.addressed}
          onCheckedChange={(v) => void onSetAddressed(lead.place_id, v === true)}
          aria-label={`Mark ${lead.business_name} done`}
        />
      </TableCell>
    </TableRow>
  );
});

export function WorkspaceClient({
  initialLeads,
  config,
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
}) {
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState(initialLeads);
  const [tab, setTab] = useState<WorkspaceTab>("all");
  const [market, setMarket] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [salesStatus, setSalesStatus] = useState(ALL);
  const [crmStatus, setCrmStatus] = useState(ALL);
  const [minScore, setMinScore] = useState(0);
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<CrmStatus>("Contacted");

  useEffect(() => {
    setLeads(initialLeads);
  }, [initialLeads]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (
      tabParam === "triage" ||
      tabParam === "client" ||
      tabParam === "vendor" ||
      tabParam === "all"
    ) {
      setTab(tabParam);
    }
    const place = searchParams.get("place");
    if (place) setDetailId(place);
  }, [searchParams]);

  const categoryLabelMap = useMemo(
    () => new Map(config.categories.map((c) => [c.key, c.label])),
    [config.categories],
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
    if (results.every(Boolean))
      toast.success(`Marked ${ids.length} leads ${addressed ? "done" : "not done"}`);
    setSelected(new Set());
  };

  return (
    <div className="space-y-6">
      <PageHeader description="Work callable leads in one place — filter, triage, set CRM status, and mark done as you go." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as WorkspaceTab)}>
        <TabsList>
          <TabsTrigger value="all">All ({tabCounts.all})</TabsTrigger>
          <TabsTrigger value="client">Clients ({tabCounts.client})</TabsTrigger>
          <TabsTrigger value="vendor">Vendors ({tabCounts.vendor})</TabsTrigger>
          <TabsTrigger value="triage">Triage ({tabCounts.triage})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="glass sticky top-14 z-10">
        <CardContent className="flex flex-wrap items-end gap-4 py-5">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search business, city, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Market</Label>
            <Select value={market} onValueChange={setMarket}>
              <SelectTrigger className="w-36">
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
              <SelectTrigger className="w-44">
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
              <SelectTrigger className="w-40">
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
              <SelectTrigger className="w-40">
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
          <div className="w-44 space-y-1.5">
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
            <Switch id="hide-done" checked={hideDone} onCheckedChange={setHideDone} />
            <Label htmlFor="hide-done" className="text-xs text-muted-foreground">
              Hide done
            </Label>
          </div>
        </CardContent>
      </Card>

      {selected.size > 0 ? (
        <Card className="glass border-primary/30">
          <CardContent className="flex flex-wrap items-center gap-3 py-3">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as CrmStatus)}>
              <SelectTrigger className="h-8 w-36">
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
            <Button size="sm" variant="secondary" onClick={() => void bulkSetStatus()}>
              Set status
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void bulkSetDone(true)}>
              Mark done
            </Button>
            <Button size="sm" variant="outline" onClick={() => void bulkSetDone(false)}>
              Mark not done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card className="glass !overflow-visible px-4 py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(v) => toggleSelectAll(v === true)}
                    aria-label="Select all visible leads"
                  />
                </TableHead>
                <TableHead>Business</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="whitespace-nowrap">Market</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="whitespace-nowrap text-center">Score</TableHead>
                <TableHead className="whitespace-nowrap">Verification</TableHead>
                <TableHead className="whitespace-nowrap">Phone</TableHead>
                {tab === "triage" ? (
                  <TableHead className="whitespace-nowrap">Why</TableHead>
                ) : (
                  <TableHead className="whitespace-nowrap">Sales</TableHead>
                )}
                <TableHead className="w-44 whitespace-nowrap">CRM Status</TableHead>
                <TableHead className="w-16 whitespace-nowrap text-center">Done</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="h-32 text-center text-sm text-muted-foreground">
                    No leads match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((lead) => (
                  <LeadTableRow
                    key={lead.place_id}
                    lead={lead}
                    tab={tab}
                    selected={selected.has(lead.place_id)}
                    categoryLabel={
                      categoryLabelMap.get(lead.category_key ?? "") ??
                      lead.category_key ??
                      "—"
                    }
                    onSelect={toggleSelect}
                    onOpenDetail={openDetail}
                    onSetStatus={setStatus}
                    onSetAddressed={setAddressed}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
