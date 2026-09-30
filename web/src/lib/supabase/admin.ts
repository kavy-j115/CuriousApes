import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// The ONE place in this app that constructs a service-role client --
// bypasses RLS entirely. Every caller of getAdminClient() MUST already
// have verified (via the session-aware client) that the current user is
// actually an admin, same two-step pattern as api/reports/[clientId] --
// this function itself does no authorization, it just returns a
// privileged handle once the caller has proven it's allowed to use one.
export function getAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set -- admin actions unavailable.");
  }
  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
