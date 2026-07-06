import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getFeatureOutcomeStats, getLatestInsightReport } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const [report, live] = await Promise.all([
    getLatestInsightReport(),
    getFeatureOutcomeStats(),
  ]);

  const reportJson = report?.report_json ?? {};
  const labeledCount = report?.labeled_count ?? 0;
  const positive = (reportJson.top_positive_predictors as { feature: string; correlation: number }[] | undefined) ?? [];
  const negative = (reportJson.top_negative_predictors as { feature: string; correlation: number }[] | undefined) ?? [];
  const calibration =
    (reportJson.score_calibration as { score_min: number; score_max: number; win_rate: number; total: number }[] | undefined) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Insights"
        description="Outcome learning — what predicts wins, and whether lead score tracks reality."
      />

      {labeledCount < 20 ? (
        <Card className="glass border-amber-500/30">
          <CardContent className="py-5 text-sm text-muted-foreground">
            Need at least <strong>20</strong> labeled outcomes for useful patterns (
            {labeledCount} so far). Close deals in CRM with the outcome dialog, or have partners
            post feedback via the API. Then run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">pallares-leads insights</code>.
          </CardContent>
        </Card>
      ) : null}

      {report ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Top positive predictors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {positive.length === 0 ? (
                <p className="text-muted-foreground">No report yet.</p>
              ) : (
                positive.slice(0, 8).map((row) => (
                  <div key={row.feature} className="flex items-center justify-between gap-2">
                    <code className="text-xs">{row.feature}</code>
                    <Badge variant="outline">r={row.correlation.toFixed(3)}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Top negative predictors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {negative.slice(0, 8).map((row) => (
                <div key={row.feature} className="flex items-center justify-between gap-2">
                  <code className="text-xs">{row.feature}</code>
                  <Badge variant="outline">r={row.correlation.toFixed(3)}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="glass">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No insight report in the database. Run{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">pallares-leads insights</code> after
            labeling outcomes.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Win rate by category (live)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Wins</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {live.winRateByCategory.map((row) => (
                  <TableRow key={row.bucket}>
                    <TableCell>{row.bucket}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.wins}/{row.total}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(row.smoothed_win_rate * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Score calibration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {calibration.length === 0 ? (
              <p className="text-sm text-muted-foreground">Run insights after more labeled leads.</p>
            ) : (
              calibration.map((band) => (
                <div
                  key={`${band.score_min}-${band.score_max}`}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="w-24 tabular-nums text-muted-foreground">
                    {band.score_min.toFixed(0)}–{band.score_max.toFixed(0)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, band.win_rate * 100)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums">
                    {(band.win_rate * 100).toFixed(0)}%
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
