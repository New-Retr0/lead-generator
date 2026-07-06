import { createClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  return data.user;
}

export function isAdminUser(user: { app_metadata?: Record<string, unknown> } | null): boolean {
  if (!user) return false;
  const flag = user.app_metadata?.is_admin;
  return flag === true || flag === "true";
}

export async function requireAdminUser() {
  const user = await getAuthenticatedUser();
  if (!isAdminUser(user)) {
    throw new Error("Admin access required");
  }
  return user;
}
