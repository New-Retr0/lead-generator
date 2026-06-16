import postgres from "postgres";

let _sql: ReturnType<typeof postgres> | null = null;

export function dbAvailable(): boolean {
  return Boolean(process.env.SUPABASE_DB_URL?.trim());
}

export function getSql() {
  const url = process.env.SUPABASE_DB_URL?.trim();
  if (!url) {
    throw new Error("SUPABASE_DB_URL is not set. Add it to sales-app/.env.local.");
  }
  if (!_sql) {
    _sql = postgres(url, {
      prepare: false,
      max: 5,
      idle_timeout: 20,
      connect_timeout: 30,
    });
  }
  return _sql;
}
