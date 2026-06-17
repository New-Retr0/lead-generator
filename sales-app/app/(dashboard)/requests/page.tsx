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
import { listRequests } from "@/lib/db";
import { formatUsd } from "@/lib/utils";

export default async function RequestsPage() {
  const requests = await listRequests();

  return (
    <div className="space-y-6">
      <PageHeader description="Natural-language lead requests — read-only history." />

      <Card>
        <CardHeader>
          <CardTitle>Request history</CardTitle>
          <CardDescription>
            Submitted via the operator dashboard. New requests are created by the developer only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {requests.map((req) => (
                  <div
                    key={req.request_id}
                    className="rounded-lg border border-border bg-card p-3 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <RunStatusBadge status={req.status} />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {req.created_at.slice(0, 16).replace("T", " ")}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm font-medium leading-relaxed">
                      {req.raw_prompt}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        <p className="text-muted-foreground">Delivered</p>
                        <p className="font-semibold tabular-nums">{req.leads_delivered}</p>
                      </div>
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        <p className="text-muted-foreground">Credits</p>
                        <p className="font-semibold tabular-nums">{req.credits_spent}</p>
                      </div>
                      <div className="rounded-md bg-muted/60 px-2 py-1.5">
                        <p className="text-muted-foreground">USD</p>
                        <p className="font-semibold tabular-nums">
                          {formatUsd(req.usd_spent ?? 0)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Prompt</TableHead>
                      <TableHead className="text-right">Delivered</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">USD</TableHead>
                      <TableHead className="whitespace-nowrap">Created</TableHead>
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
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          {req.created_at.slice(0, 16).replace("T", " ")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
