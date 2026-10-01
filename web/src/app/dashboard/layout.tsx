import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import DashboardShell from "./_components/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);

  // proxy.ts already redirects unauthenticated requests to /login, but a
  // deleted user_profiles row (auth still valid, profile gone) would slip
  // through that check -- this catches that case specifically.
  if (!profile) {
    redirect("/login");
  }

  // RLS on `clients` already returns exactly the right scoped set per role
  // (is_admin() sees all, has_client_access() limits a 'user'/'client' to
  // their assigned rows) -- no role branching needed in this query itself.
  const { data: clients } = await supabase
    .from("clients")
    .select("client_id, display_name")
    .order("display_name");

  return (
    <DashboardShell profile={profile} clients={clients ?? []}>
      {children}
    </DashboardShell>
  );
}
