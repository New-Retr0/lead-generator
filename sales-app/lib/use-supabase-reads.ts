/** Vercel serverless cannot reach direct db.* hostnames; use Supabase Data API + RLS. */
export function shouldUseSupabaseReads(): boolean {
  return process.env.VERCEL === "1" || !process.env.SUPABASE_DB_URL?.trim();
}
