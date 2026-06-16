import { RunsTableClient } from "@/components/runs/runs-table-client";
import { listRuns } from "@/lib/db";

export default async function RunsPage() {
  const runs = await listRuns();
  return <RunsTableClient initialRuns={runs} />;
}
