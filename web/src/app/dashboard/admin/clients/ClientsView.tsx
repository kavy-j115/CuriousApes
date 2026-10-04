"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import ClientRow, { type ClientRowData } from "./ClientRow";
import CreateClientForm from "./CreateClientForm";

export type ClientListItem = {
  client: ClientRowData;
  clientLogin: string | null;
  clientLoginId: string | null;
  access: { user_id: string; expires_at: string | null }[];
};
type StaffUser = { id: string; label: string; role: string };
type Filter = "all" | "syncing" | "paused" | "setup";

const needsSetup = (c: ClientRowData) => !c.paused_at && (!c.shopify_connected_at || !c.meta_ad_account_id);
const isSyncing = (c: ClientRowData) => c.sync_enabled && !c.paused_at;

export default function ClientsView({ items, users }: { items: ClientListItem[]; users: StaffUser[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(items.length === 0);

  const counts = useMemo(
    () => ({
      all: items.length,
      syncing: items.filter((i) => isSyncing(i.client)).length,
      paused: items.filter((i) => i.client.paused_at).length,
      setup: items.filter((i) => needsSetup(i.client)).length,
    }),
    [items]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(({ client }) => {
      if (filter === "syncing" && !isSyncing(client)) return false;
      if (filter === "paused" && !client.paused_at) return false;
      if (filter === "setup" && !needsSetup(client)) return false;
      return !q || `${client.display_name} ${client.client_id}`.toLowerCase().includes(q);
    });
  }, [items, query, filter]);

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "syncing", label: "Syncing" },
    { key: "setup", label: "Needs setup" },
    { key: "paused", label: "Disconnected" },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-zinc-50">Clients</h1>
          <span className="text-sm text-zinc-500">{counts.all} total</span>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          {adding ? <X size={14} /> : <Plus size={14} />}
          {adding ? "Close" : "Add client"}
        </button>
      </div>

      {adding && <CreateClientForm />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <Search size={14} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients"
            className="w-56 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-full bg-zinc-900 p-1">
          {pills.map((p) => (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === p.key ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-100"
              }`}
            >
              {p.label} <span className="opacity-70">{counts[p.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div data-tour="client-table" className="flex flex-col gap-3">
        {shown.map((item) => (
          <ClientRow key={item.client.client_id} client={item.client} clientLogin={item.clientLogin} clientLoginId={item.clientLoginId} access={item.access} users={users} />
        ))}
        {shown.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            {items.length === 0 ? "No clients yet -- add the first one." : "No clients match."}
          </p>
        )}
      </div>
    </div>
  );
}
