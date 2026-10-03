import { redirect } from "next/navigation";
import { getProfile, getClients } from "@/lib/dashboardData";
import { resolveSelectedClient } from "@/lib/selectedClient";
import DashboardShell from "./_components/DashboardShell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Fetched together (and shared with the page below via request-scoped
  // caching) instead of one after another -- each is a round trip to the
  // database, which is far from the web server.
  const [profile, allClients] = await Promise.all([getProfile(), getClients()]);

  // proxy.ts already redirects unauthenticated requests to /login, but a
  // deleted user_profiles row (auth still valid, profile gone) would slip
  // through that check -- this catches that case specifically.
  if (!profile) {
    redirect("/login");
  }

  // A temporary password (new account, or reset by an admin) must be replaced
  // before anything else is shown.
  if (profile.must_change_password) {
    redirect("/change-password");
  }

  // RLS on `clients` already returns exactly the right scoped set per role
  // (is_admin() sees all, has_client_access() limits a 'user'/'client' to
  // their assigned rows). Only id + name go to the browser, not report_config.
  const clients = allClients.map(({ client_id, display_name }) => ({ client_id, display_name }));

  // Layouts don't receive the page's ?client= query param (only page.tsx
  // does), so this resolves cookie-or-first only -- ClientDropdown still
  // prefers the URL's own ?client= on top of this when present. Passed
  // down as a prop (not re-read from the cookie client-side) so the
  // server-rendered HTML and the client's first paint agree -- React
  // deliberately skips reconciling a controlled <select>'s value during
  // hydration (the same allowance that protects browser autofill), so a
  // client-only cookie read would compute the right value but never
  // actually get applied to the DOM on first load.
  const initialSelectedClient = await resolveSelectedClient(undefined, clients);

  return (
    <DashboardShell profile={profile} clients={clients} initialSelectedClient={initialSelectedClient} showTour={!profile.has_seen_tour}>
      {children}
    </DashboardShell>
  );
}
