"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Phone, Search } from "lucide-react";
import { toast } from "sonner";
import { ScoreBadge, VerificationBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CRM_STATUSES, type CrmStatus, type LeadRow, type PipelineConfig } from "@/lib/types";

const LeadDetailModal = dynamic(
  () => import("@/components/lead-detail-modal").then((m) => m.LeadDetailModal),
  { ssr: false },
);

const ALL = "__all__";

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

type CrmRowProps = {
  lead: LeadRow;
  categoryLabel: string;
  onOpen: (placeId: string) => void;
  onStatusChange: (placeId: string, status: CrmStatus) => void;
};

const CrmTableRow = memo(function CrmTableRow({
  lead,
  categoryLabel,
  onOpen,
  onStatusChange,
}: CrmRowProps) {
  return (
    <TableRow
      className="cursor-pointer transition-colors hover:bg-accent/25"
      onClick={() => onOpen(lead.place_id)}
    >
      <TableCell>
        <p className="font-medium">{lead.business_name}</p>
        <p className="text-xs text-muted-foreground">{lead.city ?? "—"}</p>
      </TableCell>
      <TableCell>
        <Badge variant={lead.lead_type === "vendor" ? "secondary" : "outline"}>
          {lead.lead_type === "vendor" ? "Vendor" : "Client"}
        </Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {lead.market_key ?? "—"}
      </TableCell>
      <TableCell>
        <Badge variant="outline">{categoryLabel}</Badge>
      </TableCell>
      <TableCell className="text-center">
        <ScoreBadge score={lead.lead_score} />
      </TableCell>
      <TableCell>
        <VerificationBadge level={lead.verification_level} />
      </TableCell>
      <TableCell>
        {lead.phone ? (
          <span className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
            <Phone className="size-3 text-muted-foreground" />
            {lead.phone}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Select
          value={lead.crm_status}
          onValueChange={(v) => onStatusChange(lead.place_id, v as CrmStatus)}
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
    </TableRow>
  );
});

export function CrmClient({
  initialLeads,
  config,
}: {
  initialLeads: LeadRow[];
  config: PipelineConfig;
}) {
  const [leads, setLeads] = useState(initialLeads);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"all" | "client" | "vendor">("all");
  const [market, setMarket] = useState(ALL);
  const [crmStatus, setCrmStatus] = useState(ALL);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const skipFilterFetch = useRef(true);

  const categoryLabelMap = useMemo(
    () => new Map(config.categories.map((c) => [c.key, c.label])),
    [config],
  );

  useEffect(() => {
    if (skipFilterFetch.current) {
      skipFilterFetch.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (tab !== "all") params.set("type", tab);
    if (market !== ALL) params.set("market", market);
    if (crmStatus !== ALL) params.set("crmStatus", crmStatus);
    params.set("limit", "1000");
    const run = async () => {
      try {
        const res = await fetch(`/api/leads?${params.toString()}`);
        const data = (await res.json()) as { leads?: LeadRow[] };
        if (!cancelled) setLeads(data.leads ?? []);
      } catch {
        if (!cancelled) setLeads([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [tab, market, crmStatus, refreshKey]);

  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l) =>
        l.business_name.toLowerCase().includes(q) ||
        (l.city ?? "").toLowerCase().includes(q) ||
        (l.phone ?? "").includes(q),
    );
  }, [leads, deferredSearch]);

  const setStatus = useCallback(async (placeId: string, status: CrmStatus) => {
    setLeads((prev) =>
      prev.map((l) => (l.place_id === placeId ? { ...l, crm_status: status } : l)),
    );
    const res = await fetch(`/api/leads/${encodeURIComponent(placeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error("Failed to save status");
      setRefreshKey((k) => k + 1);
    }
  }, []);

  const openDetail = useCallback((placeId: string) => setDetailId(placeId), []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) c[l.crm_status] = (c[l.crm_status] ?? 0) + 1;
    return c;
  }, [leads]);

  return (
    <div className="space-y-6">
      <PageHeader description="Callable leads with a shared status the whole team can manage." />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="client">Clients</TabsTrigger>
          <TabsTrigger value="vendor">Vendors</TabsTrigger>
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
              <SelectTrigger className="w-40">
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
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={crmStatus} onValueChange={setCrmStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {CRM_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s} {counts[s] ? `(${counts[s]})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="glass min-w-0 !overflow-visible px-4 py-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="border-b border-border/50 bg-card [&_th]:bg-card">
              <TableRow className="hover:bg-transparent">
                <TableHead>Business</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Market</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-center">Score</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-44">CRM Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                    Loading CRM…
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                    No leads here yet. Launch a run, then work them from this board.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((lead) => (
                  <CrmTableRow
                    key={lead.place_id}
                    lead={lead}
                    categoryLabel={
                      categoryLabelMap.get(lead.category_key ?? "") ??
                      lead.category_key ??
                      "—"
                    }
                    onOpen={openDetail}
                    onStatusChange={(id, s) => void setStatus(id, s)}
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
