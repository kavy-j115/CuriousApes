import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveSelectedClient } from "@/lib/selectedClient";
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

  // Layouts don't receive the page's ?client= query param (only page.tsx
  // does), so this resolves cookie-or-first only -- ClientDropdown still
  // prefers the URL's own ?client= on top of this when present. Passed
  // down as a prop (not re-read from the cookie client-side) so the
  // server-rendered HTML and the client's first paint agree -- React
  // deliberately skips reconciling a controlled <select>'s value during
  // hydration (the same allowance that protects browser autofill), so a
  // client-only cookie read would compute the right value but never
  // actually get applied to the DOM on first load.
  const initialSelectedClient = await resolveSelectedClient(undefined, clients ?? []);

  return (
    <DashboardShell profile={profile} clients={clients ?? []} initialSelectedClient={initialSelectedClient}>
      {children}
    </DashboardShell>
  );
}
