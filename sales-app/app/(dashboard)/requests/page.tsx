"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { RunStatusBadge } from "@/components/badges";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatUsd } from "@/lib/utils";
import type { RequestRow } from "@/lib/types";

export default function RequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);

  useEffect(() => {
    void fetch("/api/requests")
      .then((r) => r.json())
      .then((data) => setRequests(data.requests ?? []));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader description="Natural-language lead requests — read-only history." />

      <Card className="glass">
        <CardHeader>
          <CardTitle>Request history</CardTitle>
          <CardDescription>
            Submitted via the operator dashboard. New requests are created by the developer only.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Prompt</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Credits</TableHead>
                  <TableHead className="text-right">USD</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.request_id}>
                    <TableCell>
                      <RunStatusBadge status={req.status} />
                    </TableCell>
                    <TableCell className="max-w-md truncate font-medium">
                      {req.raw_prompt}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {req.leads_delivered}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {req.credits_spent}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(req.usd_spent ?? 0)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {req.created_at.slice(0, 16).replace("T", " ")}
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
