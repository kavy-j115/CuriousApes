"use client";

import { useRouter } from "next/navigation";

type Client = { client_id: string; display_name: string };

export default function ReportControls({
  clients,
  selectedClient,
  selectedFrom,
  selectedTo,
  tab,
}: {
  clients: Client[];
  selectedClient: string;
  selectedFrom: string;
  selectedTo: string;
  tab: string;
}) {
  const router = useRouter();

  function navigate(next: { client?: string; from?: string; to?: string }) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    const client = next.client ?? selectedClient;
    const from = next.from ?? selectedFrom;
    const to = next.to ?? selectedTo;
    if (client) params.set("client", client);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {tab === "report" && (
        <>
          <input
            type="date"
            value={selectedFrom}
            onChange={(e) => navigate({ from: e.target.value })}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            aria-label="From date"
          />
          <span className="text-zinc-500">–</span>
          <input
            type="date"
            value={selectedTo}
            onChange={(e) => navigate({ to: e.target.value })}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            aria-label="To date"
          />
          {(selectedFrom || selectedTo) && (
            <button
              onClick={() => navigate({ from: "", to: "" })}
              className="text-xs text-zinc-500 hover:underline"
            >
              clear
            </button>
          )}
        </>
      )}
      {clients.length > 1 && (
        <select
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
          value={selectedClient}
          onChange={(e) => navigate({ client: e.target.value })}
        >
          {clients.map((c) => (
            <option key={c.client_id} value={c.client_id}>
              {c.display_name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
