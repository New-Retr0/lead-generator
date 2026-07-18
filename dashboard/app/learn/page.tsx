import { LearnPageClient } from "@/components/learn/learn-page-client";
import {
  getFeatureOutcomeStats,
  getLatestInsightReport,
} from "@/lib/db";

export const dynamic = "force-dynamic";

const LEARNED_SCORE_MIN_LABELS = 150;

export default async function LearnPage() {
  const [report, stats] = await Promise.all([
    getLatestInsightReport(),
    getFeatureOutcomeStats(),
  ]);

  const labeledCount = Math.max(
    report?.labeled_count ?? 0,
    ...stats.winRateByCategory.map((row) => row.total),
    ...stats.winRateByMarket.map((row) => row.total),
    0,
  );

  return (
    <LearnPageClient
      report={report}
      winRateByCategory={stats.winRateByCategory}
      winRateByMarket={stats.winRateByMarket}
      labeledCount={labeledCount}
      labelThreshold={LEARNED_SCORE_MIN_LABELS}
    />
  );
}
