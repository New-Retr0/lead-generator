"use client";

import { Coins, DollarSign, PhoneCall, Users } from "lucide-react";
import { Stagger, StaggerItem } from "@/components/animated";
import { StatCard, type StatCardDetail } from "@/components/stat-card";
import { formatCredits, formatUsdCompact } from "@/lib/utils";

export function OverviewStatCards({
  totalLeads,
  enrichedLeads,
  totalLeadsDetails,
  readyToCall,
  readyToCallSub,
  readyToCallDetails,
  firecrawlValue,
  firecrawlSub,
  firecrawlDetails,
  totalUsd,
  spendSub,
  spendDetails,
}: {
  totalLeads: number;
  enrichedLeads: number;
  totalLeadsDetails: StatCardDetail[];
  readyToCall: number;
  readyToCallSub: string;
  readyToCallDetails: StatCardDetail[];
  firecrawlValue: number;
  firecrawlSub: string;
  firecrawlDetails: StatCardDetail[];
  totalUsd: number;
  spendSub: string;
  spendDetails: StatCardDetail[];
}) {
  return (
    <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StaggerItem className="h-full">
        <StatCard
          label="Total leads"
          value={totalLeads}
          sub={`${enrichedLeads} enriched`}
          details={totalLeadsDetails}
          expandable
          icon={Users}
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          label="Ready to call"
          value={readyToCall}
          sub={readyToCallSub}
          details={readyToCallDetails}
          expandable
          icon={PhoneCall}
          tone="success"
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          label="Firecrawl remaining"
          value={firecrawlValue}
          format={(n) => formatCredits(n)}
          sub={firecrawlSub}
          details={firecrawlDetails}
          expandable
          icon={Coins}
          tone="warning"
        />
      </StaggerItem>
      <StaggerItem className="h-full">
        <StatCard
          label="Pipeline spend (month)"
          value={totalUsd}
          format={(n) => formatUsdCompact(n)}
          sub={spendSub}
          details={spendDetails}
          expandable
          icon={DollarSign}
        />
      </StaggerItem>
    </Stagger>
  );
}
