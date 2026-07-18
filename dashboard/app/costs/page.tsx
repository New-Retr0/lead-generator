import { CostsClient } from "@/components/costs/costs-client";
import { getCostSeries } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const initialData = await getCostSeries(30);
  return <CostsClient initialDays={30} initialData={initialData} />;
}
