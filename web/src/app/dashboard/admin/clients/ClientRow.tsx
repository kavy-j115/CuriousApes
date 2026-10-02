"use client";

import Select from "../../_components/Select";
import Checkbox from "../../_components/Checkbox";
import { useState, useTransition } from "react";
import { Trash2, ChevronDown, ChevronRight, Copy, Check } from "lucide-react";
import {
  deleteClientRecord,
  updateClientReportConfig,
  updateClientNotifications,
  reassignClient,
  updateClientConnections,
  setClientSyncEnabled,
  createShopifyInstallLink,
} from "../actions";
import { AVAILABLE_METRICS, ALL_METRIC_KEYS, defaultLabel, DEFAULT_ROAS_THRESHOLDS, type MetricKey, type ReportConfig, type DerivedColumn } from "@/lib/reportColumns";
import { validateFormula } from "@/lib/formulaEval";

type AlertThresholds = { revenue_change_pct?: number; cac_change_pct?: number; roas_change_pct?: number } | null;

type ClientRowData = {
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
};
type AssignableUser = { id: string; email: string | null; display_name: string | null };

export default function ClientRow({
  client,
  assignedUserId,
  assignableUsers,
}: {
  client: ClientRowData;
  assignedUserId: string | null;
  assignableUsers: AssignableUser[];
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [useDefault, setUseDefault] = useState(!client.report_config);
  const [enabled, setEnabled] = useState<Set<MetricKey>>(
    new Set(client.report_config ? client.report_config.columns.map((c) => c.key) : [])
  );
  const [labels, setLabels] = useState<Record<string, string>>(
    Object.fromEntries((client.report_config?.columns ?? []).map((c) => [c.key, c.label]))
  );
  const [goodThreshold, setGoodThreshold] = useState(
    String(client.report_config?.roasThresholds?.good ?? DEFAULT_ROAS_THRESHOLDS.good)
  );
  const [dangerThreshold, setDangerThreshold] = useState(
    String(client.report_config?.roasThresholds?.danger ?? DEFAULT_ROAS_THRESHOLDS.danger)
  );
  const [derivedColumns, setDerivedColumns] = useState<DerivedColumn[]>(client.report_config?.derivedColumns ?? []);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [revenuePct, setRevenuePct] = useState(String(client.alert_thresholds?.revenue_change_pct ?? ""));
  const [cacPct, setCacPct] = useState(String(client.alert_thresholds?.cac_change_pct ?? ""));
  const [roasPct, setRoasPct] = useState(String(client.alert_thresholds?.roas_change_pct ?? ""));
  const [recipients, setRecipients] = useState((client.whatsapp_recipients ?? []).join(", "));
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [storeDomain, setStoreDomain] = useState(client.shopify_store_domain ?? "");
  const [metaAccount, setMetaAccount] = useState(client.meta_ad_account_id ?? "");
  const [ga4Property, setGa4Property] = useState(client.ga4_property_id ?? "");
  const [installLink, setInstallLink] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deleted, setDeleted] = useState(false);
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
      const good = Number(goodThreshold) || DEFAULT_ROAS_THRESHOLDS.good;
      const danger = Number(dangerThreshold) || DEFAULT_ROAS_THRESHOLDS.danger;
      const thresholdsChanged = good !== DEFAULT_ROAS_THRESHOLDS.good || danger !== DEFAULT_ROAS_THRESHOLDS.danger;
      const validDerived = derivedColumns.filter((dc) => dc.key.trim() && dc.label.trim() && dc.formula.trim() && !formulaError(derivedColumns.indexOf(dc)));

      if (useDefault && !thresholdsChanged && validDerived.length === 0) {
        await updateClientReportConfig(client.client_id, null);
        return;
      }

      const columns = useDefault
        ? []
        : AVAILABLE_METRICS.filter((m) => enabled.has(m.key)).map((m) => ({
            key: m.key,
            label: labels[m.key]?.trim() || m.defaultLabel,
          }));
      await updateClientReportConfig(client.client_id, {
        columns,
        roasThresholds: { good, danger },
        derivedColumns: validDerived.length > 0 ? validDerived : undefined,
      });
    });
  }

  function handleDelete() {
    if (!confirm(`Delete ${client.display_name}? Fails if they still have synced data.`)) return;
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteClientRecord(client.client_id);
        setDeleted(true);
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : "Delete failed.");
      }
    });
  }

  function saveConnections() {
    setConnectionError(null);
    setInstallLink(null);
    startTransition(async () => {
      try {
        await updateClientConnections(client.client_id, {
          shopifyStoreDomain: storeDomain,
          metaAdAccountId: metaAccount,
          ga4PropertyId: ga4Property,
        });
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
      else setInstallLink(result.url);
    });
  }

  async function copyInstallLink() {
    if (!installLink) return;
    await navigator.clipboard.writeText(installLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleSyncToggle(next: boolean) {
    startTransition(async () => {
      await setClientSyncEnabled(client.client_id, next);
    });
  }

  function handleReassign(newUserId: string) {
    startTransition(async () => {
      await reassignClient(client.client_id, newUserId || null);
    });
  }

  function saveNotifications() {
    startTransition(async () => {
      const thresholds: AlertThresholds = {};
      if (revenuePct) thresholds!.revenue_change_pct = Number(revenuePct);
      if (cacPct) thresholds!.cac_change_pct = Number(cacPct);
      if (roasPct) thresholds!.roas_change_pct = Number(roasPct);
      const recipientList = recipients.split(",").map((p) => p.trim()).filter(Boolean);
      await updateClientNotifications(
        client.client_id,
        Object.keys(thresholds!).length > 0 ? thresholds : null,
        recipientList
      );
    });
  }

  if (deleted) return null;

  return (
    <>
      <tr className="border-b border-zinc-900 text-zinc-300">
        <td className="px-3 py-1.5 font-mono text-xs">{client.client_id}</td>
        <td className="px-3 py-1.5">{client.display_name}</td>
        <td className="px-3 py-1.5">
          <span className={pending ? "pointer-events-none opacity-50" : ""}>
            <Select value={assignedUserId ?? ""} onChange={handleReassign} className="min-w-44">
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
              ))}
            </Select>
          </span>
        </td>
        <td className="px-3 py-1.5">
          <button onClick={() => setColumnsOpen((v) => !v)} className="flex items-center gap-1 text-xs text-accent hover:underline">
            {columnsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} columns
          </button>
        </td>
        <td className="px-3 py-1.5">
          <button onClick={() => setNotificationsOpen((v) => !v)} className="flex items-center gap-1 text-xs text-accent hover:underline">
            {notificationsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} alerts/WhatsApp
          </button>
        </td>
        <td className="px-3 py-1.5">
          <button onClick={() => setConnectionsOpen((v) => !v)} className="flex items-center gap-1 text-xs text-accent hover:underline">
            {connectionsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} connections
          </button>
        </td>
        <td className="px-3 py-1.5">
          <span className={pending ? "pointer-events-none opacity-50" : ""}>
            <Checkbox checked={client.sync_enabled} onChange={handleSyncToggle} label={client.sync_enabled ? "On" : "Off"} />
          </span>
        </td>
        <td className="px-3 py-1.5 text-right">
          <button onClick={handleDelete} disabled={pending} aria-label="Delete client" className="rounded p-1.5 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad">
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {columnsOpen && (
        <tr className="border-b border-zinc-900">
          <td colSpan={8} className="bg-black px-3 py-3">
            {deleteError && <p className="mb-2 text-xs text-status-bad">{deleteError}</p>}
            <Checkbox className="mb-3" checked={useDefault} onChange={setUseDefault} label="Use default report configuration" />

            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-300">
              <span className="text-zinc-400">PROAS good ≥</span>
              <input
                type="number"
                step="0.1"
                value={goodThreshold}
                onChange={(e) => setGoodThreshold(e.target.value)}
                className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
              />
              <span className="text-zinc-400">danger &lt;</span>
              <input
                type="number"
                step="0.1"
                value={dangerThreshold}
                onChange={(e) => setDangerThreshold(e.target.value)}
                className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
              />
            </div>

            {!useDefault && (
              <div className="flex flex-col gap-1.5">
                {AVAILABLE_METRICS.map((m) => (
                  <div key={m.key} className="flex items-center gap-2">
                    <Checkbox className="w-48" checked={enabled.has(m.key)} onChange={() => toggleMetric(m.key)} label={m.key} />
                    <input
                      type="text"
                      disabled={!enabled.has(m.key)}
                      placeholder={defaultLabel(m.key)}
                      value={labels[m.key] ?? ""}
                      onChange={(e) => setLabels((prev) => ({ ...prev, [m.key]: e.target.value }))}
                      className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 disabled:opacity-40"
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 border-t border-zinc-900 pt-3">
              <p className="mb-1.5 text-xs font-medium text-zinc-300">Extra computed columns</p>
              <p className="mb-2 text-xs text-zinc-500">{ALL_METRIC_KEYS.join(", ")}</p>
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
          </td>
        </tr>
      )}
      {connectionsOpen && (
        <tr className="border-b border-zinc-900">
          <td colSpan={8} className="bg-black px-3 py-3">
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
                Meta ad account ID
                <input
                  value={metaAccount}
                  onChange={(e) => setMetaAccount(e.target.value)}
                  placeholder="1234567890"
                  className="mt-1 block w-44 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100"
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

            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className={client.shopify_connected_at ? "text-status-good" : "text-zinc-500"}>
                {client.shopify_connected_at
                  ? `Shopify connected ${new Date(client.shopify_connected_at).toLocaleDateString()}`
                  : "Shopify not connected"}
              </span>
              <button
                onClick={generateInstallLink}
                disabled={pending || !client.shopify_store_domain}
                className="rounded border border-zinc-800 px-2.5 py-1 text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-40"
              >
                {client.shopify_connected_at ? "Reconnect Shopify" : "Connect Shopify"}
              </button>
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
          </td>
        </tr>
      )}
      {notificationsOpen && (
        <tr className="border-b border-zinc-900">
          <td colSpan={8} className="bg-black px-3 py-3">
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
            <p className="mb-1 text-xs font-medium text-zinc-300">WhatsApp recipients</p>
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
          </td>
        </tr>
      )}
    </>
  );
}
