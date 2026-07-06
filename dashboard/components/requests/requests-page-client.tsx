"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Layers, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { RunStatusBadge } from "@/components/badges";
import { JobLogPanel } from "@/components/job-log-panel";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/console/section-heading";
import { TypedText } from "@/components/console/typed-text";
import { RequestsBuilder } from "@/components/requests/requests-builder";
import { RunLauncher } from "@/components/requests/run-launcher";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PipelineConfig, RequestRow } from "@/lib/types";

export function RequestsPageClient({
  requests,
  config,
}: {
  requests: RequestRow[];
  config: PipelineConfig;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <SectionHeading index="01" title="Launch Hub" />
      <PageHeader description="Request qualified lead batches or launch pipeline runs — watch live progress in the job log." />
      <TypedText text="DISCOVER + ENRICH — single pass per place" />

      <JobLogPanel
        jobId={jobId}
        onDone={(status) => {
          router.refresh();
          if (status === "completed") toast.success("Job finished");
          else if (status === "failed") toast.error("Job failed — check the log");
        }}
      />

      <Tabs defaultValue="request">
        <TabsList>
          <TabsTrigger value="request">
            <Wand2 className="size-3.5" />
            Lead request
          </TabsTrigger>
          <TabsTrigger value="pipeline">
            <Layers className="size-3.5" />
            Pipeline run
          </TabsTrigger>
        </TabsList>
        <TabsContent value="request" className="mt-4">
          <RequestsBuilder config={config} onJobStarted={setJobId} />
        </TabsContent>
        <TabsContent value="pipeline" className="mt-4">
          <RunLauncher config={config} onJobStarted={setJobId} />
        </TabsContent>
      </Tabs>

      <Card className="glass min-w-0">
        <CardHeader>
          <CardTitle>Request history</CardTitle>
          <CardDescription>
            Past requests with delivery counts and actual credit spend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            requests.map((req) => (
              <Collapsible
                key={req.request_id}
                className="group rounded-lg border bg-card transition-colors hover:border-primary/25"
              >
                <CollapsibleTrigger className="flex w-full cursor-pointer list-none flex-wrap items-center gap-2.5 p-3 text-left">
                  <RunStatusBadge status={req.status} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {req.raw_prompt}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {req.leads_delivered} delivered · {req.credits_spent} cr
                    {req.usd_spent != null ? ` · $${req.usd_spent.toFixed(2)}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {req.created_at.slice(0, 16).replace("T", " ")}
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mx-3 mb-3 max-h-60 overflow-auto rounded-md bg-secondary/60 p-3 font-mono text-xs">
                    {JSON.stringify(req.spec, null, 2)}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
