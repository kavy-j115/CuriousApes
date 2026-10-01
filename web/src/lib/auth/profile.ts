import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Kept in sync with user_profiles.role's CHECK constraint (sql/011_auth_and_rls.sql).
export type Role = "admin" | "user" | "client";

export type Profile = {
  id: string;
  email: string | null;
  role: Role;
  display_name: string | null;
};

// Reads the logged-in user's role via the session-aware client, not the
// service role key -- this relies on user_profiles' own "users see their
// own profile" RLS policy (id = auth.uid()), so it works for any role
// without needing is_admin()/has_client_access() at all.
export async function getCurrentProfile(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<Profile | null> {
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub as string | undefined;
  if (!userId) return null;

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, role, display_name")
    .eq("id", userId)
    .single();

  if (!profile) return null;

  return {
    id: profile.id as string,
    email: (data!.claims.email as string) ?? null,
    role: profile.role as Role,
    display_name: profile.display_name as string | null,
  };
}

// Redirects a role that isn't in `allowed` back to their own dashboard
// home, rather than letting them view a page meant for a different role.
// This is UI-layer politeness, not the real security boundary -- RLS on
// the underlying tables is what actually stops a client from reading
// another client's data even if a route check like this were ever missed.
export function assertRole(profile: Profile, allowed: Role[]) {
  if (!allowed.includes(profile.role)) {
    redirect("/dashboard");
  }
}
