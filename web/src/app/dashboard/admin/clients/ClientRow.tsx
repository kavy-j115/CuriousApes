"use client";

import Checkbox from "../../_components/Checkbox";
import Select from "../../_components/Select";
import MultiSelect from "../../_components/MultiSelect";
import Link from "next/link";
import { notify, withToast } from "@/lib/notify";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import SyncNowModal from "./SyncNowModal";
import { Trash2, KeyRound, Copy, Check, Link2 } from "lucide-react";
import {
  deleteClientRecord,
  pauseClient,
  resumeClient,
  updateClientReportConfig,
  resetUserPassword,
  updateClientNotifications,
  updateClientConnections,
  setClientSyncEnabled,
  createShopifyInstallLink,
  setClientUserAccess,
  grantTemporaryAccess,
  revokeAccess,
} from "../actions";
import { AVAILABLE_METRICS, ALL_METRIC_KEYS, defaultLabel, type MetricKey, type ReportConfig, type DerivedColumn } from "@/lib/reportColumns";
import { validateFormula } from "@/lib/formulaEval";

type AlertThresholds = { revenue_change_pct?: number; cac_change_pct?: number; roas_change_pct?: number } | null;

export type ClientRowData = {
  client_id: string;
  display_name: string;
  created_at: string;
  report_config: ReportConfig;
  alert_thresholds: AlertThresholds;
  whatsapp_recipients: string[];
  shopify_store_domain: string | null;
  meta_ad_account_id: string | null;
  ga4_property_id: string | null;
  shopify_connected_at: string | null;
  sync_enabled: boolean;
  paused_at: string | null;
  pause_reason: string | null;
  initial_sync_done: boolean;
  backfill_from?: string | null;
  meta_account_name?: string | null;
};

type AccessUser = { id: string; label: string; role: string };
type AccessRow = { user_id: string; expires_at: string | null };

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
}

type Tone = "good" | "warn" | "bad" | "muted";
const TONES: Record<Tone, string> = {
  good: "bg-status-good/15 text-status-good",
  warn: "bg-status-warning/15 text-status-warning",
  bad: "bg-status-bad/15 text-status-bad",
  muted: "bg-zinc-900 text-zinc-400",
};

function Dot({ on }: { on: boolean }) {
  return <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-status-good" : "bg-zinc-600"}`} />;
}

function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${TONES[tone]}`}>{children}</span>;
}

function Section({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
        open ? "bg-accent/15 text-accent" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

export default function ClientRow({
  client,
  users,
  access,
  clientLogin,
  clientLoginId,
}: {
  client: ClientRowData;
  users: AccessUser[];
  access: AccessRow[];
  clientLogin: string | null;
  clientLoginId: string | null;
}) {
  // One panel open at a time: opening a tab closes the others.
  const [openTab, setOpenTab] = useState<"report" | "alerts" | "access" | "connections" | null>(null);
  const columnsOpen = openTab === "report";
  const notificationsOpen = openTab === "alerts";
  const accessOpen = openTab === "access";
  const connectionsOpen = openTab === "connections";
  const toggleTab = (tab: NonNullable<typeof openTab>) => setOpenTab((cur) => (cur === tab ? null : tab));
  const [useDefault, setUseDefault] = useState(!client.report_config);
  const [enabled, setEnabled] = useState<Set<MetricKey>>(
    new Set(client.report_config ? client.report_config.columns.map((c) => c.key) : [])
  );
  const [labels, setLabels] = useState<Record<string, string>>(
    Object.fromEntries((client.report_config?.columns ?? []).map((c) => [c.key, c.label]))
  );
  const [headerColor, setHeaderColor] = useState(client.report_config?.headerColor ? `#${client.report_config.headerColor.replace(/^#/, "")}` : "");
  const [idealRoas, setIdealRoas] = useState(client.report_config?.idealRoas ? String(client.report_config.idealRoas) : "");
  const [derivedColumns, setDerivedColumns] = useState<DerivedColumn[]>(client.report_config?.derivedColumns ?? []);
  const [revenuePct, setRevenuePct] = useState(String(client.alert_thresholds?.revenue_change_pct ?? ""));
  const [cacPct, setCacPct] = useState(String(client.alert_thresholds?.cac_change_pct ?? ""));
  const [roasPct, setRoasPct] = useState(String(client.alert_thresholds?.roas_change_pct ?? ""));
  const [recipients, setRecipients] = useState((client.whatsapp_recipients ?? []).join(", "));
  const permanentUserIds = access.filter((a) => !a.expires_at).map((a) => a.user_id);
  const temporaryAccess = access.filter((a) => a.expires_at);
  const [accessSelected, setAccessSelected] = useState<string[]>(permanentUserIds);
  const [collabUserId, setCollabUserId] = useState("");
  const userLabel = (id: string) => users.find((u) => u.id === id)?.label ?? id;
  const accessDirty = accessSelected.length !== permanentUserIds.length || permanentUserIds.some((id) => !accessSelected.includes(id));
  const collabCandidates = users.filter((u) => u.role === "user" && !access.some((a) => a.user_id === u.id));
  const [storeDomain, setStoreDomain] = useState(client.shopify_store_domain ?? "");
  const [ga4Property, setGa4Property] = useState(client.ga4_property_id ?? "");
  const [installLink, setInstallLink] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [loginPassword, setLoginPassword] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const router = useRouter();
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncDefault, setSyncDefault] = useState<string | null>(null);
  // A new client whose Shopify is connected but has not had its first sync: offer it once.
  const needsFirstSync = !!client.shopify_connected_at && !client.initial_sync_done && !client.paused_at;
  useEffect(() => {
    if (!needsFirstSync) return;
    try {
      if (sessionStorage.getItem(`syncPrompt:${client.client_id}`)) return;
      sessionStorage.setItem(`syncPrompt:${client.client_id}`, "1");
    } catch {
      /* private mode: just show it */
    }
    setSyncDefault(client.backfill_from ?? null);
    setSyncOpen(true);
  }, [needsFirstSync, client.client_id, client.backfill_from]);
  // The store owner installs the app in their own tab: refresh when this tab is focused again.
  useEffect(() => {
    if (client.shopify_connected_at || !client.shopify_store_domain) return;
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client.shopify_connected_at, client.shopify_store_domain, router]);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function toggleMetric(key: MetricKey) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addDerivedColumn() {
    setDerivedColumns((prev) => [...prev, { key: `custom_${prev.length + 1}`, label: "", formula: "", isPct: false }]);
  }

  function updateDerivedColumn(index: number, patch: Partial<DerivedColumn>) {
    setDerivedColumns((prev) => prev.map((dc, i) => (i === index ? { ...dc, ...patch } : dc)));
  }

  function removeDerivedColumn(index: number) {
    setDerivedColumns((prev) => prev.filter((_, i) => i !== index));
  }

  // A derived column's formula can reference any built-in metric plus any
  // *earlier* derived column's key (chaining) -- validated against that
  // combined whitelist so a typo'd field name is caught here, in the
  // editor, rather than silently producing a blank column later.
  function formulaError(index: number): string | null {
    const dc = derivedColumns[index];
    if (!dc.formula.trim()) return null;
    const allowed = [...ALL_METRIC_KEYS, ...derivedColumns.slice(0, index).map((d) => d.key)];
    return validateFormula(dc.formula, allowed);
  }

  function saveColumns() {
    startTransition(async () => {
      const color = /^#[0-9a-fA-F]{6}$/.test(headerColor) ? headerColor.slice(1) : undefined;
      const validDerived = derivedColumns.filter((dc) => dc.key.trim() && dc.label.trim() && dc.formula.trim() && !formulaError(derivedColumns.indexOf(dc)));

      const ideal = Number(idealRoas);
      const idealValue = idealRoas.trim() && Number.isFinite(ideal) && ideal > 0 ? ideal : undefined;

      if (useDefault && !color && validDerived.length === 0 && idealValue === undefined) {
        await withToast(() => updateClientReportConfig(client.client_id, null), "Report settings saved");
        return;
      }

      const columns = useDefault
        ? []
        : AVAILABLE_METRICS.filter((m) => enabled.has(m.key)).map((m) => ({
            key: m.key,
            label: labels[m.key]?.trim() || m.defaultLabel,
          }));
      await withToast(
        () =>
          updateClientReportConfig(client.client_id, {
            columns,
            derivedColumns: validDerived.length > 0 ? validDerived : undefined,
            headerColor: color,
            idealRoas: idealValue,
          }),
        "Report settings saved"
      );
    });
  }

  function resetClientLoginPassword() {
    if (!clientLoginId || !confirm(`Reset the password for ${clientLogin}? They will have to choose a new one at next login.`)) return;
    startTransition(async () => {
      try {
        const { tempPassword } = await resetUserPassword(clientLoginId);
        setLoginPassword(tempPassword);
        notify("Password reset");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't reset the password.", "error");
      }
    });
  }

  function handlePause() {
    if (!confirm(`Disconnect ${client.display_name}? It is hidden from every screen and nothing is fetched. Credentials and stored data are kept, and Reconnect brings it back and fills the missed days. Nothing is changed on Shopify or Meta.`)) return;
    startTransition(async () => {
      await withToast(() => pauseClient(client.client_id), "Client disconnected");
    });
  }

  function handleResume() {
    startTransition(async () => {
      try {
        const res = await resumeClient(client.client_id);
        notify("Client reconnected");
        setSyncDefault(res?.backfillFrom ?? null);
        setSyncOpen(true);
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't reconnect.", "error");
      }
    });
  }

  function handleDelete() {
    const typed = window.prompt(
      `Permanently delete ${client.display_name}? This removes the client, ALL its stored data and its saved credentials, and cannot be undone.\n\nReminder: nothing is changed on Shopify or Meta. To end access there too, remove the app from the store's Apps settings in Shopify and stop sharing the ad account in Meta Business Settings.\n\nType the client ID (${client.client_id}) to confirm.`
    );
    if (typed === null) return;
    if (typed.trim() !== client.client_id) {
      notify("That doesn't match the client ID -- nothing was deleted.", "error");
      return;
    }
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteClientRecord(client.client_id);
        setDeleted(true);
        notify("Client deleted");
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  function saveAccess() {
    startTransition(async () => {
      await withToast(() => setClientUserAccess(client.client_id, accessSelected), "Access saved");
    });
  }

  function grantCollab() {
    if (!collabUserId) return;
    startTransition(async () => {
      await withToast(() => grantTemporaryAccess(collabUserId, client.client_id), "Access granted for 24 hours");
      setCollabUserId("");
    });
  }

  function revokeCollab(userId: string) {
    startTransition(async () => {
      await withToast(() => revokeAccess(userId, client.client_id), "Access ended");
    });
  }

  function saveConnections() {
    setConnectionError(null);
    setInstallLink(null);
    startTransition(async () => {
      try {
        await updateClientConnections(client.client_id, {
          shopifyStoreDomain: storeDomain,
          ga4PropertyId: ga4Property,
        });
        notify("Connections saved");
      } catch (e) {
        setConnectionError(e instanceof Error ? e.message : "Couldn't save.");
      }
    });
  }

  function generateInstallLink() {
    setConnectionError(null);
    startTransition(async () => {
      const result = await createShopifyInstallLink(client.client_id);
      if ("error" in result) setConnectionError(result.error);
      else {
        setInstallLink(result.url);
        notify("Install link created");
      }
    });
  }

  async function copyInstallLink() {
    if (!installLink) return;
    await navigator.clipboard.writeText(installLink);
    setCopied(true);
    notify("Link copied");
    setTimeout(() => setCopied(false), 1500);
  }

  function handleSyncToggle(next: boolean) {
    startTransition(async () => {
      await withToast(() => setClientSyncEnabled(client.client_id, next), next ? "Sync turned on" : "Sync turned off");
    });
  }

  function saveNotifications() {
    startTransition(async () => {
      const thresholds: AlertThresholds = {};
      if (revenuePct) thresholds!.revenue_change_pct = Number(revenuePct);
      if (cacPct) thresholds!.cac_change_pct = Number(cacPct);
      if (roasPct) thresholds!.roas_change_pct = Number(roasPct);
      const recipientList = recipients.split(",").map((p) => p.trim()).filter(Boolean);
      await withToast(
        () => updateClientNotifications(client.client_id, Object.keys(thresholds!).length > 0 ? thresholds : null, recipientList),
        "Alerts and WhatsApp numbers saved"
      );
    });
  }

  if (deleted) return null;

  return (
    <div className={`overflow-hidden rounded-xl border bg-zinc-950 ${client.paused_at ? "border-zinc-900" : "border-zinc-800"}`}>
      {syncOpen && (
        <SyncNowModal clientId={client.client_id} name={client.display_name} defaultFrom={syncDefault} onClose={() => setSyncOpen(false)} />
      )}
      <div className={`flex flex-wrap items-start justify-between gap-4 p-4 ${client.paused_at ? "opacity-75" : ""}`}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm font-semibold text-accent">
            {client.display_name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-zinc-50">{client.display_name}</p>
              <span className="font-mono text-[11px] text-zinc-500">{client.client_id}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              {client.paused_at && (
                <Chip tone="warn">
                  Disconnected {new Date(client.paused_at).toLocaleDateString()}
                  {client.pause_reason === "meta_access_lost" ? " · Meta access lost" : ""}
                </Chip>
              )}
              <span className="inline-flex items-center gap-1.5">
                <Dot on={!!client.shopify_connected_at} />
                {client.shopify_connected_at ? "Shopify" : "Shopify not connected"}
              </span>
              <Link
                href={`/dashboard/admin/meta?client=${client.client_id}`}
                title={client.meta_ad_account_id ? "Change the linked ad account" : "Link an ad account"}
                className="inline-flex items-center gap-1.5 hover:text-accent"
              >
                <Dot on={!!client.meta_ad_account_id} />
                {client.meta_ad_account_id ? `Meta: ${client.meta_account_name ?? client.meta_ad_account_id}` : "Meta not linked"}
              </Link>
              {needsFirstSync && (
                <button onClick={() => { setSyncDefault(client.backfill_from ?? null); setSyncOpen(true); }} className="font-medium text-accent hover:underline">
                  Sync now
                </button>
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
              {clientLogin ?? "No client login"}
              {clientLoginId && (
                <button onClick={resetClientLoginPassword} disabled={pending} aria-label="Reset client password" title="Reset password" className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-accent">
                  <KeyRound size={12} />
                </button>
              )}
            </div>
            {loginPassword && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5 rounded border border-status-good/30 bg-status-good/10 px-2 py-1 text-xs text-status-good">
                Temporary password: <span className="font-mono">{loginPassword}</span>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(loginPassword);
                    notify("Password copied");
                  }}
                  className="rounded border border-status-good/40 px-1.5 hover:bg-status-good/10"
                >
                  Copy
                </button>
                <button onClick={() => setLoginPassword(null)} className="text-zinc-500 hover:text-zinc-300">
                  Hide
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={pending ? "pointer-events-none opacity-50" : ""}>
            <Checkbox checked={client.sync_enabled && !client.paused_at} onChange={handleSyncToggle} label="Sync" />
          </span>
          {client.paused_at ? (
            <button onClick={handleResume} disabled={pending} className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-40">
              Reconnect
            </button>
          ) : (
            <button onClick={handlePause} disabled={pending} className="rounded-md border border-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:border-status-warning hover:text-status-warning disabled:opacity-40">
              Disconnect
            </button>
          )}
          <button onClick={handleDelete} disabled={pending} aria-label="Delete client" title="Delete client" className="rounded-md p-1.5 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-t border-zinc-900 px-3 py-2">
        <Section open={columnsOpen} onClick={() => toggleTab("report")}>Report</Section>
        <Section open={notificationsOpen} onClick={() => toggleTab("alerts")}>Alerts and WhatsApp</Section>
        <Section open={accessOpen} onClick={() => toggleTab("access")}>Access ({access.length})</Section>
        <Section open={connectionsOpen} onClick={() => toggleTab("connections")}>Connections</Section>
      </div>
      {columnsOpen && (
        <div className="border-t border-zinc-900 bg-black/50 px-4 py-4">
            {deleteError && <p className="mb-2 text-xs text-status-bad">{deleteError}</p>}
            <Checkbox className="mb-3" checked={useDefault} onChange={setUseDefault} label="Use default report configuration" />

            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-300">
              <span className="text-zinc-400">Header color</span>
              <input
                type="color"
                value={headerColor || "#4472c4"}
                onChange={(e) => setHeaderColor(e.target.value)}
                className="h-7 w-10 cursor-pointer rounded border border-zinc-800 bg-zinc-950"
              />
              {headerColor && (
                <button onClick={() => setHeaderColor("")} className="text-zinc-500 hover:text-zinc-300">
                  reset
                </button>
              )}
            </div>

            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-300">
              <span className="text-zinc-400">Ideal ROAS</span>
              <input
                type="number"
                step="0.1"
                min="0"
                placeholder="e.g. 4"
                value={idealRoas}
                onChange={(e) => setIdealRoas(e.target.value)}
                className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
              />
            </div>

            {!useDefault && (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {AVAILABLE_METRICS.map((m) => (
                  <div
                    key={m.key}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors ${
                      enabled.has(m.key) ? "border-zinc-700 bg-zinc-900/60" : "border-zinc-900 bg-zinc-950"
                    }`}
                  >
                    <Checkbox className="shrink-0" checked={enabled.has(m.key)} onChange={() => toggleMetric(m.key)} label={<span className="font-mono text-[11px] text-zinc-300">{m.key}</span>} />
                    <input
                      type="text"
                      disabled={!enabled.has(m.key)}
                      placeholder={defaultLabel(m.key)}
                      value={labels[m.key] ?? ""}
                      onChange={(e) => setLabels((prev) => ({ ...prev, [m.key]: e.target.value }))}
                      className="ml-auto w-28 min-w-0 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-40"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-zinc-900 pt-3">
              <p className="mb-1.5 text-xs font-medium text-zinc-300">Extra computed columns</p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {ALL_METRIC_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    title="Copy"
                    onClick={() => {
                      void navigator.clipboard.writeText(k);
                      notify(`Copied ${k}`);
                    }}
                    className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-300 transition-colors hover:border-accent hover:text-accent"
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {derivedColumns.map((dc, i) => {
                  const error = formulaError(i);
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        placeholder="Label"
                        value={dc.label}
                        onChange={(e) => updateDerivedColumn(i, { label: e.target.value })}
                        className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                      />
                      <input
                        type="text"
                        placeholder="e.g. purchase_value / amount_spent"
                        value={dc.formula}
                        onChange={(e) => updateDerivedColumn(i, { formula: e.target.value })}
                        className={`flex-1 min-w-48 rounded border bg-zinc-950 px-2 py-1 text-xs text-zinc-100 ${error ? "border-status-bad" : "border-zinc-800"}`}
                      />
                      <Select value={dc.after ?? ""} onChange={(v) => updateDerivedColumn(i, { after: (v || undefined) as MetricKey | undefined })}>
                        <option value="">At the end</option>
                        {AVAILABLE_METRICS.map((m) => (
                          <option key={m.key} value={m.key}>After {defaultLabel(m.key)}</option>
                        ))}
                      </Select>
                      <Checkbox checked={dc.isPct} onChange={(v) => updateDerivedColumn(i, { isPct: v })} label="%" />
                      <button onClick={() => removeDerivedColumn(i)} className="text-xs text-zinc-500 hover:text-status-bad">
                        remove
                      </button>
                      {error && <p className="w-full text-xs text-status-bad">{error}</p>}
                    </div>
                  );
                })}
              </div>
              <button onClick={addDerivedColumn} className="mt-2 text-xs text-accent hover:underline">
                + Add computed column
              </button>
            </div>

            <button onClick={saveColumns} disabled={pending} className="mt-3 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save columns"}
            </button>
        </div>
      )}
      {accessOpen && (
        <div className="border-t border-zinc-900 bg-black/50 px-4 py-4">
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Users with access</p>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <MultiSelect
                placeholder="No users"
                options={users.map((u) => ({ id: u.id, label: u.label, hint: u.role }))}
                selected={accessSelected}
                onChange={setAccessSelected}
              />
              <button onClick={saveAccess} disabled={!accessDirty || pending} className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {pending ? "Saving…" : "Save"}
              </button>
            </div>

            <p className="mb-1.5 text-xs font-medium text-zinc-400">Collab (24h)</p>
            <div className="flex flex-col gap-1.5">
              {temporaryAccess.map((t) => {
                const hours = hoursLeft(t.expires_at!);
                return (
                  <div key={t.user_id} className="flex items-center gap-2 text-xs text-zinc-300">
                    <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-status-warning">
                      {userLabel(t.user_id)} -- {hours > 0 ? `${hours}h left` : "expired"}
                    </span>
                    <button onClick={() => revokeCollab(t.user_id)} disabled={pending} className="text-zinc-500 hover:text-status-bad">
                      revoke
                    </button>
                  </div>
                );
              })}
              {collabCandidates.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={collabUserId} onChange={setCollabUserId}>
                    <option value="">Give a user 24h access…</option>
                    {collabCandidates.map((u) => (
                      <option key={u.id} value={u.id}>{u.label}</option>
                    ))}
                  </Select>
                  <button onClick={grantCollab} disabled={!collabUserId || pending} className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                    Grant
                  </button>
                </div>
              )}
            </div>
        </div>
      )}
      {connectionsOpen && (
        <div className="border-t border-zinc-900 bg-black/50 px-4 py-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="text-xs text-zinc-400">
                Shopify store domain
                <input
                  value={storeDomain}
                  onChange={(e) => setStoreDomain(e.target.value)}
                  placeholder="brand.myshopify.com"
                  className="mt-1 block w-60 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
                />
              </label>
              <label className="text-xs text-zinc-400">
                GA4 property ID
                <input
                  value={ga4Property}
                  onChange={(e) => setGa4Property(e.target.value)}
                  placeholder="123456789"
                  className="mt-1 block w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
                />
              </label>
              <button onClick={saveConnections} disabled={pending} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                {pending ? "Saving…" : "Save"}
              </button>
            </div>

            <div className="mt-4 divide-y divide-zinc-900 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Shopify</p>
                  <p className={`mt-0.5 text-sm ${client.shopify_connected_at ? "text-status-good" : "text-zinc-400"}`}>
                    {client.shopify_connected_at
                      ? `Connected ${new Date(client.shopify_connected_at).toLocaleDateString()}`
                      : "Not connected"}
                  </p>
                </div>
                <button
                  onClick={generateInstallLink}
                  disabled={pending || !client.shopify_store_domain}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                    client.shopify_connected_at
                      ? "border border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-accent hover:text-accent"
                      : "bg-accent text-white hover:opacity-90"
                  }`}
                >
                  {client.shopify_connected_at ? "Reconnect Shopify" : "Connect Shopify"}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Meta ad account</p>
                  <p className={`mt-0.5 text-sm ${client.meta_ad_account_id ? "text-status-good" : "text-zinc-400"}`}>
                    {client.meta_ad_account_id ? (
                      <>
                        {client.meta_account_name ?? "Linked"}
                        <span className="ml-2 font-mono text-xs text-zinc-500">{client.meta_ad_account_id}</span>
                      </>
                    ) : (
                      "Not linked"
                    )}
                  </p>
                </div>
                <Link
                  href={`/dashboard/admin/meta?client=${client.client_id}`}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    client.meta_ad_account_id
                      ? "border border-zinc-700 bg-zinc-900 text-zinc-100 hover:border-accent hover:text-accent"
                      : "bg-accent text-white hover:opacity-90"
                  }`}
                >
                  <Link2 size={13} />
                  {client.meta_ad_account_id ? "Change ad account" : "Link ad account"}
                </Link>
              </div>
            </div>

            {installLink && (
              <div className="mt-3 flex max-w-2xl items-center gap-2">
                <input readOnly value={installLink} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300" />
                <button onClick={copyInstallLink} aria-label="Copy install link" className="rounded border border-zinc-800 p-1.5 text-zinc-300 hover:border-accent hover:text-accent">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}
            {connectionError && <p className="mt-2 text-xs text-status-bad">{connectionError}</p>}
        </div>
      )}
      {notificationsOpen && (
        <div className="border-t border-zinc-900 bg-black/50 px-4 py-4">
            <p className="mb-2 text-xs font-medium text-zinc-300">Alert thresholds</p>
            <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-zinc-300">
              <label className="flex items-center gap-1.5">
                Revenue drop
                <input type="number" step="1" value={revenuePct} onChange={(e) => setRevenuePct(e.target.value)} placeholder="off" className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100" />%
              </label>
              <label className="flex items-center gap-1.5">
                CAC increase
                <input type="number" step="1" value={cacPct} onChange={(e) => setCacPct(e.target.value)} placeholder="off" className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100" />%
              </label>
              <label className="flex items-center gap-1.5">
                ROAS drop
                <input type="number" step="1" value={roasPct} onChange={(e) => setRoasPct(e.target.value)} placeholder="off" className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100" />%
              </label>
            </div>
            <p className="mb-1 text-xs font-medium text-zinc-300">WhatsApp numbers</p>
            <input
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="+919876543210, +919876543211"
              className="mb-3 w-full max-w-md rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
            />
            <button onClick={saveNotifications} disabled={pending} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save"}
            </button>
        </div>
      )}
    </div>
  );
}
