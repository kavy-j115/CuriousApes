import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import ClientsView, { type ClientListItem } from "./ClientsView";
import type { ReportConfig } from "@/lib/reportColumns";

export default async function AdminClientsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, { data: users }, { data: access }, { data: metaAccounts }] = await Promise.all([
    supabase
      .from("clients")
      .select("client_id, display_name, created_at, report_config, alert_thresholds, whatsapp_recipients, shopify_store_domain, meta_ad_account_id, ga4_property_id, shopify_connected_at, sync_enabled, paused_at, pause_reason, initial_sync_done, backfill_from, all_orders_access")
      .order("created_at", { ascending: false }),
    supabase.from("user_profiles").select("id, email, display_name, role").neq("role", "admin").order("display_name"),
    supabase.from("client_access").select("user_id, client_id, expires_at"),
    supabase.from("meta_ad_accounts").select("account_id, name"),
  ]);
  const accountName = new Map((metaAccounts ?? []).map((a) => [a.account_id as string, a.name as string]));

  const staff = (users ?? [])
    .filter((u) => u.role === "user")
    .map((u) => ({ id: u.id as string, label: (u.display_name || u.email || u.id) as string, role: u.role as string }));

  const items: ClientListItem[] = (clients ?? []).map((c) => {
    const login = (users ?? []).find(
      (u) => u.role === "client" && (access ?? []).some((a) => a.user_id === u.id && a.client_id === c.client_id && !a.expires_at)
    );
    return {
      client: {
        ...c,
        report_config: c.report_config as ReportConfig,
        alert_thresholds: c.alert_thresholds as { revenue_change_pct?: number; cac_change_pct?: number; roas_change_pct?: number } | null,
        whatsapp_recipients: (c.whatsapp_recipients as string[] | null) ?? [],
        meta_account_name: c.meta_ad_account_id ? accountName.get(c.meta_ad_account_id as string) ?? null : null,
      },
      clientLogin: (login?.email as string | undefined) ?? null,
      clientLoginId: (login?.id as string | undefined) ?? null,
      access: (access ?? []).filter((a) => a.client_id === c.client_id).map((a) => ({ user_id: a.user_id as string, expires_at: a.expires_at as string | null })),
    };
  });

  const lost = items.filter((i) => i.client.pause_reason === "meta_access_lost");

  return (
    <div>
      {lost.length > 0 && (
        <div className="mb-5 max-w-6xl rounded-xl border border-status-warning/40 bg-status-warning/10 p-4 text-sm text-status-warning">
          <p className="font-medium">Meta access lost -- remove these from the client list if they have left:</p>
          <p className="mt-1 text-zinc-200">{lost.map((i) => i.client.display_name).join(", ")}</p>
          <p className="mt-1 text-xs text-zinc-400">
            Fetching is stopped and they are hidden. Use the trash icon on their card to delete them with all their data, or
            Reconnect if the access comes back.
          </p>
        </div>
      )}
      <ClientsView items={items} users={staff} />
    </div>
  );
}
