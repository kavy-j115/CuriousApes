import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import PermissionsView, { type PermissionRow } from "./PermissionsView";

export default async function AdminPermissionsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, { data: profiles }, { data: access }] = await Promise.all([
    supabase.from("clients").select("client_id, display_name").order("display_name"),
    supabase.from("user_profiles").select("id, email, display_name, role").order("display_name"),
    supabase.from("client_access").select("user_id, client_id, expires_at"),
  ]);

  const clientsByUser = new Map<string, string[]>();
  for (const row of access ?? []) {
    const client = clients?.find((c) => c.client_id === row.client_id);
    if (!client) continue;
    // A 24-hour collab grant is labelled so it isn't mistaken for a permanent assignment.
    const label = row.expires_at ? `${client.display_name} (24h)` : client.display_name;
    clientsByUser.set(row.user_id, [...(clientsByUser.get(row.user_id) ?? []), label as string]);
  }

  const rows: PermissionRow[] = (profiles ?? []).map((p) => ({
    id: p.id as string,
    name: (p.display_name as string | null) ?? "",
    email: (p.email as string | null) ?? "",
    role: p.role as PermissionRow["role"],
    clients: clientsByUser.get(p.id as string) ?? [],
  }));

  return <PermissionsView rows={rows} />;
}
