"use client";

import { useState, useTransition } from "react";
import { Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { deleteClientRecord, updateClientReportConfig, reassignClient } from "../actions";
import { AVAILABLE_METRICS, defaultLabel, DEFAULT_ROAS_THRESHOLDS, type MetricKey, type ReportConfig } from "@/lib/reportColumns";

type ClientRowData = {
  client_id: string;
  display_name: string;
  created_at: string;
  report_config: ReportConfig;
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

  function saveColumns() {
    startTransition(async () => {
      const good = Number(goodThreshold) || DEFAULT_ROAS_THRESHOLDS.good;
      const danger = Number(dangerThreshold) || DEFAULT_ROAS_THRESHOLDS.danger;
      const thresholdsChanged = good !== DEFAULT_ROAS_THRESHOLDS.good || danger !== DEFAULT_ROAS_THRESHOLDS.danger;

      if (useDefault && !thresholdsChanged) {
        await updateClientReportConfig(client.client_id, null);
        return;
      }

      const columns = useDefault
        ? []
        : AVAILABLE_METRICS.filter((m) => enabled.has(m.key)).map((m) => ({
            key: m.key,
            label: labels[m.key]?.trim() || m.defaultLabel,
          }));
      await updateClientReportConfig(client.client_id, { columns, roasThresholds: { good, danger } });
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

  function handleReassign(newUserId: string) {
    startTransition(async () => {
      await reassignClient(client.client_id, newUserId || null);
    });
  }

  if (deleted) return null;

  return (
    <>
      <tr className="border-b border-zinc-900 text-zinc-300">
        <td className="px-3 py-1.5 font-mono text-xs">{client.client_id}</td>
        <td className="px-3 py-1.5">{client.display_name}</td>
        <td className="px-3 py-1.5">
          <select
            value={assignedUserId ?? ""}
            onChange={(e) => handleReassign(e.target.value)}
            disabled={pending}
            className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-300"
          >
            <option value="">— unassigned —</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.display_name || u.email}</option>
            ))}
          </select>
        </td>
        <td className="px-3 py-1.5">
          <button onClick={() => setColumnsOpen((v) => !v)} className="flex items-center gap-1 text-xs text-sky-400 hover:underline">
            {columnsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />} columns
          </button>
        </td>
        <td className="px-3 py-1.5 text-right">
          <button onClick={handleDelete} disabled={pending} aria-label="Delete client" className="rounded p-1.5 text-zinc-500 hover:bg-red-950/40 hover:text-red-400">
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {columnsOpen && (
        <tr className="border-b border-zinc-900">
          <td colSpan={5} className="bg-black px-3 py-3">
            {deleteError && <p className="mb-2 text-xs text-red-400">{deleteError}</p>}
            <label className="mb-2 flex items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} />
              Use default report configuration
            </label>

            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-300">
              <span className="text-zinc-400">PROAS colors: green at or above</span>
              <input
                type="number"
                step="0.1"
                value={goodThreshold}
                onChange={(e) => setGoodThreshold(e.target.value)}
                className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
              />
              <span className="text-zinc-400">red below</span>
              <input
                type="number"
                step="0.1"
                value={dangerThreshold}
                onChange={(e) => setDangerThreshold(e.target.value)}
                className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-zinc-100"
              />
              <span className="text-zinc-400">orange between</span>
            </div>

            {!useDefault && (
              <div className="flex flex-col gap-1.5">
                {AVAILABLE_METRICS.map((m) => (
                  <div key={m.key} className="flex items-center gap-2">
                    <label className="flex w-48 items-center gap-1.5 text-xs text-zinc-300">
                      <input type="checkbox" checked={enabled.has(m.key)} onChange={() => toggleMetric(m.key)} />
                      {m.key}
                    </label>
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
            <button onClick={saveColumns} disabled={pending} className="mt-3 rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {pending ? "Saving…" : "Save columns"}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}
