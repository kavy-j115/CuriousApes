import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import { createClientRecord } from "../actions";
import ClientRow from "./ClientRow";
import type { ReportConfig } from "@/lib/reportColumns";

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none";

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

      <form action={createClientRecord} className="mb-8 flex flex-col gap-3 rounded-lg border border-zinc-800 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">client_id</label>
            <input name="client_id" required placeholder="acme-brand" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Display name</label>
            <input name="display_name" required placeholder="Acme Brand" className={inputClass} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Revenue drop alert %</label>
            <input name="revenue_change_pct" type="number" placeholder="off" className={`w-24 ${inputClass}`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">CAC increase alert %</label>
            <input name="cac_change_pct" type="number" placeholder="off" className={`w-24 ${inputClass}`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">ROAS drop alert %</label>
            <input name="roas_change_pct" type="number" placeholder="off" className={`w-24 ${inputClass}`} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-zinc-400">WhatsApp recipients</label>
            <input name="whatsapp_recipients" placeholder="+919876543210, +919876543211" className={inputClass} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Shopify store domain</label>
            <input name="shopify_store_domain" placeholder="brand.myshopify.com" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Meta ad account ID</label>
            <input name="meta_ad_account_id" placeholder="1234567890" className={`w-44 ${inputClass}`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">GA4 property ID</label>
            <input name="ga4_property_id" placeholder="123456789" className={`w-40 ${inputClass}`} />
          </div>
        </div>
        <button type="submit" className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white">
          Add client
        </button>
      </form>

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
                users={(users ?? []).map((u) => ({ id: u.id as string, label: (u.display_name || u.email || u.id) as string, role: u.role as string }))}
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
