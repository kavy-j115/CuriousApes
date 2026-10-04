"use client";

import { useMemo, useState } from "react";
import Select from "../../_components/Select";

export type PermissionRow = { id: string; name: string; email: string; role: "admin" | "user" | "client"; clients: string[] };
type View = "all" | "client" | "user" | "admin";

const LABEL: Record<PermissionRow["role"], string> = { admin: "Admin", user: "User", client: "Client" };
const BADGE: Record<PermissionRow["role"], string> = {
  admin: "bg-status-warning/15 text-status-warning",
  user: "bg-accent/15 text-accent",
  client: "bg-status-good/15 text-status-good",
};

export default function PermissionsView({ rows }: { rows: PermissionRow[] }) {
  const [view, setView] = useState<View>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      client: rows.filter((r) => r.role === "client").length,
      user: rows.filter((r) => r.role === "user").length,
      admin: rows.filter((r) => r.role === "admin").length,
    }),
    [rows]
  );
  const shown = useMemo(() => (view === "all" ? rows : rows.filter((r) => r.role === view)), [rows, view]);

  return (
    <div className="max-w-4xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-zinc-50">Permissions</h1>
          <span className="text-sm text-zinc-500">
            showing {shown.length} of {rows.length}
          </span>
        </div>
        <div className="flex items-center gap-2" data-tour="permissions-filter">
          <span className="text-xs text-zinc-500">Show</span>
          <Select value={view} onChange={(v) => setView(v as View)}>
            <option value="all">Everyone ({counts.all})</option>
            <option value="client">Clients ({counts.client})</option>
            <option value="user">Users ({counts.user})</option>
            <option value="admin">Admins ({counts.admin})</option>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin rounded-xl border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
              <th className="px-4 py-2.5">Person</th>
              <th className="px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5">{view === "client" ? "Brand" : "Client access"}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-zinc-900 text-zinc-300 hover:bg-zinc-900/40">
                <td className="px-4 py-2.5">
                  <p className="text-zinc-100">{r.name || "—"}</p>
                  <p className="text-xs text-zinc-500">{r.email}</p>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[r.role]}`}>{LABEL[r.role]}</span>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {r.role === "admin" ? (
                    "All clients"
                  ) : r.clients.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {r.clients.map((c) => (
                        <span key={c} className="rounded-full bg-zinc-900 px-2 py-0.5 text-zinc-300">
                          {c}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-zinc-600">None assigned</span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                  Nobody in this group yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
