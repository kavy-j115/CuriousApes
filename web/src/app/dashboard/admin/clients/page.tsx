import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import { createClientRecord } from "../actions";
import ClientRow from "./ClientRow";
import type { ReportConfig } from "@/lib/reportColumns";

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none";

export default async function AdminClientsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, { data: clientUsers }, { data: access }] = await Promise.all([
    supabase
      .from("clients")
      .select("client_id, display_name, created_at, report_config, alert_thresholds, whatsapp_recipients")
      .order("created_at", { ascending: false }),
    supabase.from("user_profiles").select("id, email, display_name").eq("role", "client"),
    supabase.from("client_access").select("user_id, client_id").is("expires_at", null),
  ]);

  const assignedUserByClient = new Map<string, string>();
  for (const row of access ?? []) {
    if ((clientUsers ?? []).some((u) => u.id === row.user_id)) {
      assignedUserByClient.set(row.client_id, row.user_id);
    }
  }

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
        <button type="submit" className="self-start rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white">
          Add client
        </button>
      </form>

      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
              <th className="px-3 py-2">client_id</th>
              <th className="px-3 py-2">Display name</th>
              <th className="px-3 py-2">Assigned to</th>
              <th className="px-3 py-2">Report</th>
              <th className="px-3 py-2">Notifications</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <ClientRow
                key={c.client_id}
                client={{
                  ...c,
                  report_config: c.report_config as ReportConfig,
                  alert_thresholds: c.alert_thresholds as { revenue_change_pct?: number; cac_change_pct?: number; roas_change_pct?: number } | null,
                  whatsapp_recipients: (c.whatsapp_recipients as string[] | null) ?? [],
                }}
                assignedUserId={assignedUserByClient.get(c.client_id) ?? null}
                assignableUsers={clientUsers ?? []}
              />
            ))}
            {(clients ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-zinc-500">No clients yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
