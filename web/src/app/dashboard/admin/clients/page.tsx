import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import ClientRow from "./ClientRow";
import CreateClientForm from "./CreateClientForm";
import type { ReportConfig } from "@/lib/reportColumns";

export default async function AdminClientsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, { data: users }, { data: access }] = await Promise.all([
    supabase
      .from("clients")
      .select("client_id, display_name, created_at, report_config, alert_thresholds, whatsapp_recipients, shopify_store_domain, meta_ad_account_id, ga4_property_id, shopify_connected_at, sync_enabled")
      .order("created_at", { ascending: false }),
    supabase.from("user_profiles").select("id, email, display_name, role").neq("role", "admin").order("display_name"),
    supabase.from("client_access").select("user_id, client_id, expires_at"),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-zinc-50">Clients</h1>

      <CreateClientForm />

      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
              <th className="px-3 py-2">client_id</th>
              <th className="px-3 py-2">Display name</th>
                            <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">Notifications</th>
              <th className="px-3 py-2">Access</th>
              <th className="px-3 py-2">Connections</th>
              <th className="px-3 py-2">Sync</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <ClientRow
                key={c.client_id}
                users={(users ?? []).filter((u) => u.role === "user").map((u) => ({ id: u.id as string, label: (u.display_name || u.email || u.id) as string, role: u.role as string }))}
                clientLogin={(users ?? []).find((u) => u.role === "client" && (access ?? []).some((a) => a.user_id === u.id && a.client_id === c.client_id && !a.expires_at))?.email ?? null}
                access={(access ?? []).filter((a) => a.client_id === c.client_id).map((a) => ({ user_id: a.user_id as string, expires_at: a.expires_at as string | null }))}
                client={{
                  ...c,
                  report_config: c.report_config as ReportConfig,
                  alert_thresholds: c.alert_thresholds as { revenue_change_pct?: number; cac_change_pct?: number; roas_change_pct?: number } | null,
                  whatsapp_recipients: (c.whatsapp_recipients as string[] | null) ?? [],
                }}
              />
            ))}
            {(clients ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-zinc-500">No clients yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
