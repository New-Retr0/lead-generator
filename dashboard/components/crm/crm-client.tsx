"use client";

import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Phone, PhoneCall, Search } from "lucide-react";
import { toast } from "sonner";
import { VerificationBadge } from "@/components/badges";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CRM_STATUSES,
  OUTCOME_REASONS,
  TOUCH_RESULTS,
  type CrmStatus,
  type LeadOutcomeInput,
  type LeadOutcomeValue,
  type LeadRow,
  type LeadTouchInput,
  type OutcomeReason,
  type PipelineConfig,
  type TouchResult,
} from "@/lib/types";

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

const CLOSING_STATUSES: CrmStatus[] = ["Won", "Lost", "Bad Data"];

const CRM_TO_OUTCOME: Record<CrmStatus, LeadOutcomeValue> = {
  New: "no_response",
  Contacted: "no_response",
  "Follow Up": "no_response",
  Interested: "no_response",
  "Quote Sent": "no_response",
  Won: "won",
  Lost: "lost",
  "Bad Data": "bad_data",
};

type CrmRowProps = {
  lead: LeadRow;
  categoryLabel: string;
  onOpen: (placeId: string) => void;
  onStatusChange: (placeId: string, status: CrmStatus) => void;
  onLogCall: (lead: LeadRow) => void;
};

const CrmTableRow = memo(function CrmTableRow({
  lead,
  categoryLabel,
  onOpen,
  onStatusChange,
  onLogCall,
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => onLogCall(lead)}
        >
          <PhoneCall className="size-3.5" />
          Log call
        </Button>
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
  const [outcomeLead, setOutcomeLead] = useState<LeadRow | null>(null);
  const [pendingStatus, setPendingStatus] = useState<CrmStatus | null>(null);
  const [outcomeReason, setOutcomeReason] = useState<OutcomeReason | "">("");
  const [dealValue, setDealValue] = useState("");
  const [qualityRating, setQualityRating] = useState("3");
  const [outcomeNotes, setOutcomeNotes] = useState("");
  const [dataFlags, setDataFlags] = useState<Record<string, boolean>>({
    phone_correct: true,
    contact_name_correct: true,
    contact_role_correct: true,
    still_in_business: true,
    website_correct: true,
  });
  const [callLead, setCallLead] = useState<LeadRow | null>(null);
  const [callResult, setCallResult] = useState<TouchResult>("no_answer");
  const [callNotes, setCallNotes] = useState("");

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
    if (CLOSING_STATUSES.includes(status)) {
      const lead = leads.find((l) => l.place_id === placeId) ?? null;
      setOutcomeLead(lead);
      setPendingStatus(status);
      setOutcomeReason("");
      setDealValue("");
      setQualityRating("3");
      setOutcomeNotes("");
      return;
    }
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
  }, [leads]);

  const submitOutcome = useCallback(async () => {
    if (!outcomeLead || !pendingStatus) return;
    const outcome: LeadOutcomeInput = {
      outcome: CRM_TO_OUTCOME[pendingStatus],
      outcome_reason: outcomeReason || null,
      deal_value_usd:
        pendingStatus === "Won" && dealValue ? Number.parseFloat(dealValue) : null,
      quality_rating: Number.parseInt(qualityRating, 10) || null,
      data_flags: dataFlags,
      notes: outcomeNotes || null,
    };
    const res = await fetch(`/api/leads/${encodeURIComponent(outcomeLead.place_id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: pendingStatus, outcome }),
    });
    if (!res.ok) {
      toast.error("Failed to save outcome");
      return;
    }
    setLeads((prev) =>
      prev.map((l) =>
        l.place_id === outcomeLead.place_id ? { ...l, crm_status: pendingStatus } : l,
      ),
    );
    toast.success("Outcome saved");
    setOutcomeLead(null);
    setPendingStatus(null);
  }, [
    outcomeLead,
    pendingStatus,
    outcomeReason,
    dealValue,
    qualityRating,
    dataFlags,
    outcomeNotes,
  ]);

  const submitCall = useCallback(async () => {
    if (!callLead) return;
    const touch: LeadTouchInput = {
      touch_type: "call",
      result: callResult,
      contact_phone: callLead.phone,
      notes: callNotes || null,
    };
    const res = await fetch(`/api/leads/${encodeURIComponent(callLead.place_id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touch }),
    });
    if (!res.ok) {
      toast.error("Failed to log call");
      return;
    }
    toast.success("Call logged");
    setCallLead(null);
    setCallNotes("");
  }, [callLead, callResult, callNotes]);

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
                <TableHead>Verification</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="w-28">Activity</TableHead>
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
                    onLogCall={setCallLead}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <LeadDetailModal placeId={detailId} onClose={() => setDetailId(null)} />

      <Dialog open={!!outcomeLead} onOpenChange={(open) => !open && setOutcomeLead(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record outcome — {outcomeLead?.business_name}</DialogTitle>
            <DialogDescription>
              Structured outcome data feeds lead quality learning across the pipeline.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select
                value={outcomeReason || "__none__"}
                onValueChange={(v) => setOutcomeReason(v === "__none__" ? "" : (v as OutcomeReason))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {OUTCOME_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {pendingStatus === "Won" ? (
              <div className="space-y-1.5">
                <Label>Deal value (USD)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={dealValue}
                  onChange={(e) => setDealValue(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Lead quality (1–5)</Label>
              <Select value={qualityRating} onValueChange={setQualityRating}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Data accuracy</Label>
              {Object.keys(dataFlags).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={dataFlags[key]}
                    onCheckedChange={(checked) =>
                      setDataFlags((prev) => ({ ...prev, [key]: checked === true }))
                    }
                  />
                  {key.replace(/_/g, " ")}
                </label>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={outcomeNotes} onChange={(e) => setOutcomeNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOutcomeLead(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitOutcome()}>Save outcome</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!callLead} onOpenChange={(open) => !open && setCallLead(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Log call — {callLead?.business_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Result</Label>
              <Select value={callResult} onValueChange={(v) => setCallResult(v as TouchResult)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOUCH_RESULTS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={callNotes} onChange={(e) => setCallNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCallLead(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitCall()}>Save call</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
