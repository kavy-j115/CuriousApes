import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole, type Role } from "@/lib/auth/profile";
import UserRow from "../users/UserRow";
import ClientRow from "../clients/ClientRow";
import type { ReportConfig } from "@/lib/reportColumns";

const CONFIG_DIR = path.join(process.cwd(), "..", "config");

type ClientThresholds = {
  client_id: string;
  display_name: string;
  revenue_change_pct?: number;
  cac_change_pct?: number;
  roas_change_pct?: number;
  whatsapp_recipients?: string[];
};

function readClientThresholds(): ClientThresholds[] {
  const clientsDir = path.join(CONFIG_DIR, "clients");
  if (!fs.existsSync(clientsDir)) return [];
  return fs
    .readdirSync(clientsDir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => {
      const raw = loadYaml(fs.readFileSync(path.join(clientsDir, f), "utf8")) as Record<string, unknown>;
      const thresholds = (raw.thresholds ?? {}) as Record<string, number>;
      const notifications = (raw.notifications ?? {}) as Record<string, string[]>;
      return {
        client_id: raw.client_id as string,
        display_name: raw.display_name as string,
        revenue_change_pct: thresholds.revenue_change_pct,
        cac_change_pct: thresholds.cac_change_pct,
        roas_change_pct: thresholds.roas_change_pct,
        whatsapp_recipients: notifications.whatsapp_recipients ?? [],
      };
    });
}

function readWhatsappConfig(): { phone_number_id?: string; template_name?: string; template_language?: string } | null {
  const filePath = path.join(CONFIG_DIR, "whatsapp.yaml");
  if (!fs.existsSync(filePath)) return null;
  return loadYaml(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
}

export default async function AdminSettingsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  let clients: ClientThresholds[] = [];
  let whatsapp: ReturnType<typeof readWhatsappConfig> = null;
  let readError: string | null = null;
  try {
    clients = readClientThresholds();
    whatsapp = readWhatsappConfig();
  } catch (e) {
    readError = e instanceof Error ? e.message : "Failed to read config files.";
  }

  const [{ data: allClients }, { data: profiles }, { data: access }, { data: clientUsers }] = await Promise.all([
    supabase.from("clients").select("client_id, display_name, created_at, report_config").order("display_name"),
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
        <div className="overflow-x-auto rounded-lg border border-zinc-900">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
                <th className="px-3 py-2">client_id</th>
                <th className="px-3 py-2">Display name</th>
                <th className="px-3 py-2">Assigned to</th>
                <th className="px-3 py-2">Report</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(allClients ?? []).map((c) => (
                <ClientRow
                  key={c.client_id}
                  client={{ ...c, report_config: c.report_config as ReportConfig }}
                  assignedUserId={assignedUserByClient.get(c.client_id) ?? null}
                  assignableUsers={clientUsers ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mb-4 text-sm font-semibold text-zinc-200">Alert thresholds &amp; WhatsApp</p>
      <p className="mb-6 text-xs text-zinc-500">
        Read-only -- lives in `config/*.yaml` with the Python pipeline, not the database (see
        docs/secrets.md). Edit those files directly to change them.
      </p>

      {readError && (
        <p className="mb-6 rounded border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          Couldn&apos;t read config files: {readError}
        </p>
      )}

      {!readError && (
        <>
          <div className="mb-6 rounded-lg border border-zinc-800 p-4">
            <p className="mb-2 text-sm font-semibold text-zinc-200">WhatsApp sender</p>
            {whatsapp?.phone_number_id ? (
              <ul className="space-y-1 text-sm text-zinc-400">
                <li>phone_number_id: <span className="font-mono text-zinc-300">{whatsapp.phone_number_id}</span></li>
                <li>template_name: <span className="font-mono text-zinc-300">{whatsapp.template_name}</span></li>
                <li>template_language: <span className="font-mono text-zinc-300">{whatsapp.template_language}</span></li>
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">Not configured yet -- see docs/notifications.md.</p>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-900">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
                  <th className="px-3 py-2">Client</th>
                  <th className="px-3 py-2">Revenue drop %</th>
                  <th className="px-3 py-2">CAC increase %</th>
                  <th className="px-3 py-2">ROAS drop %</th>
                  <th className="px-3 py-2">WhatsApp recipients</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.client_id} className="border-b border-zinc-900 text-zinc-300">
                    <td className="px-3 py-1.5 text-zinc-100">{c.display_name}</td>
                    <td className="px-3 py-1.5">{c.revenue_change_pct ?? "—"}</td>
                    <td className="px-3 py-1.5">{c.cac_change_pct ?? "—"}</td>
                    <td className="px-3 py-1.5">{c.roas_change_pct ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {c.whatsapp_recipients && c.whatsapp_recipients.length > 0 ? c.whatsapp_recipients.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-zinc-500">No client config files found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
