import fs from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";

const CONFIG_DIR = path.join(process.cwd(), "..", "config");

// Only the agency-level WhatsApp (Meta Cloud API) sender config is still YAML-based -- there's
// exactly one of it, same shared-credential reasoning as agency.meta_ads
// (docs/secrets.md). Per-client thresholds/WhatsApp recipients moved to
// the database (sql/018_client_notifications.sql) and are edited directly
// on each client's row below now, not read-only here.
function readWhatsappConfig(): { phone_number_id?: string; display_number?: string; alert_template?: string; report_template?: string } | null {
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

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-zinc-50">System Settings</h1>

      <p className="mb-3 text-sm font-semibold text-zinc-200">WhatsApp sender</p>
      {readError && (
        <p className="rounded border border-status-bad/30 bg-status-bad/10 p-3 text-sm text-status-bad">
          Couldn&apos;t read config/whatsapp.yaml: {readError}
        </p>
      )}

      {!readError && (
        <div className="rounded-lg border border-zinc-800 p-4">
          {whatsapp?.phone_number_id ? (
            <ul className="space-y-1 text-sm text-zinc-400">
              <li>number: <span className="font-mono text-zinc-300">{whatsapp.display_number || "—"}</span></li>
              <li>phone_number_id: <span className="font-mono text-zinc-300">{whatsapp.phone_number_id}</span></li>
              <li>alert template: <span className="font-mono text-zinc-300">{whatsapp.alert_template}</span></li>
              <li>report template: <span className="font-mono text-zinc-300">{whatsapp.report_template}</span></li>
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">Not configured yet -- see docs/notifications.md.</p>
          )}
        </div>
      )}
    </div>
  );
}
