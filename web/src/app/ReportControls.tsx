"use client";

import { useRouter } from "next/navigation";

type Client = { client_id: string; display_name: string };

export default function ReportControls({
  clients,
  selectedClient,
  selectedDate,
  tab,
}: {
  clients: Client[];
  selectedClient: string;
  selectedDate: string;
  tab: string;
}) {
  const router = useRouter();

  function navigate(next: { client?: string; date?: string }) {
    const params = new URLSearchParams();
    params.set("tab", tab);
    const client = next.client ?? selectedClient;
    const date = next.date ?? selectedDate;
    if (client) params.set("client", client);
    if (date) params.set("date", date);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {tab === "report" && (
        <>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => navigate({ date: e.target.value })}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {selectedDate && (
            <button
              onClick={() => navigate({ date: "" })}
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
