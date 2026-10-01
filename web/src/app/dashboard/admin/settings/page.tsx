import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole, type Role } from "@/lib/auth/profile";
import UserRow from "../users/UserRow";
import ClientRow from "../clients/ClientRow";
import type { ReportConfig } from "@/lib/reportColumns";

const CONFIG_DIR = path.join(process.cwd(), "..", "config");

// Only the agency-level Twilio sender config is still YAML-based -- there's
// exactly one of it, same shared-credential reasoning as agency.meta_ads
// (docs/secrets.md). Per-client thresholds/WhatsApp recipients moved to
// the database (sql/018_client_notifications.sql) and are edited directly
// on each client's row below now, not read-only here.
function readWhatsappConfig(): { account_sid?: string; from_number?: string } | null {
  const filePath = path.join(CONFIG_DIR, "whatsapp.yaml");
  if (!fs.existsSync(filePath)) return null;
  return loadYaml(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
}

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  let whatsapp: ReturnType<typeof readWhatsappConfig> = null;
  let readError: string | null = null;
  try {
    whatsapp = readWhatsappConfig();
  } catch (e) {
    readError = e instanceof Error ? e.message : "Failed to read config/whatsapp.yaml.";
  }

  const [{ data: allClients }, { data: profiles }, { data: access }, { data: clientUsers }] = await Promise.all([
    supabase
      .from("clients")
      .select("client_id, display_name, created_at, report_config, alert_thresholds, whatsapp_recipients")
      .order("display_name"),
    supabase.from("user_profiles").select("id, email, display_name, role").order("created_at"),
    supabase.from("client_access").select("user_id, client_id, expires_at"),
    supabase.from("user_profiles").select("id, email, display_name").eq("role", "client"),
  ]);

  const accessByUser = new Map<string, { client_id: string; expires_at: string | null }[]>();
  const assignedUserByClient = new Map<string, string>();
  for (const row of access ?? []) {
    const list = accessByUser.get(row.user_id) ?? [];
    list.push({ client_id: row.client_id, expires_at: row.expires_at });
    accessByUser.set(row.user_id, list);
    if (!row.expires_at && (clientUsers ?? []).some((u) => u.id === row.user_id)) {
      assignedUserByClient.set(row.client_id, row.user_id);
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-zinc-50">System Settings</h1>

      <div className="mb-8">
        <p className="mb-2 text-sm font-semibold text-zinc-200">Users &amp; clients</p>
        <div className="mb-4 flex flex-col gap-3">
          {(profiles ?? []).map((p) => (
            <UserRow
              key={p.id}
              user={{
                id: p.id as string,
                email: p.email as string | null,
                display_name: p.display_name as string | null,
                role: p.role as Role,
                access: accessByUser.get(p.id as string) ?? [],
              }}
              clients={allClients ?? []}
              currentUserId={profile.id}
            />
          ))}
        </div>
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
              {(allClients ?? []).map((c) => (
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
            </tbody>
          </table>
        </div>
      </div>

      <p className="mb-2 text-sm font-semibold text-zinc-200">WhatsApp sender (Twilio)</p>
      <p className="mb-4 text-xs text-zinc-500">
        Agency-wide, read-only here -- lives in config/whatsapp.yaml with the Python pipeline
        (see docs/notifications.md). Per-client thresholds and recipients are set above, per client.
      </p>

      {readError && (
        <p className="rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Couldn&apos;t read config/whatsapp.yaml: {readError}
        </p>
      )}

      {!readError && (
        <div className="rounded-lg border border-zinc-800 p-4">
          {whatsapp?.account_sid ? (
            <ul className="space-y-1 text-sm text-zinc-400">
              <li>account_sid: <span className="font-mono text-zinc-300">{whatsapp.account_sid}</span></li>
              <li>from_number: <span className="font-mono text-zinc-300">{whatsapp.from_number}</span></li>
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Not configured yet -- see docs/notifications.md.</p>
          )}
        </div>
      )}
    </div>
  );
}
