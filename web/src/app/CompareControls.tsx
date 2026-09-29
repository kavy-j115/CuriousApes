"use client";

import { useRouter } from "next/navigation";

type Client = { client_id: string; display_name: string };

export default function CompareControls({
  clients,
  selectedClient,
  aFrom,
  aTo,
  bFrom,
  bTo,
}: {
  clients: Client[];
  selectedClient: string;
  aFrom: string;
  aTo: string;
  bFrom: string;
  bTo: string;
}) {
  const router = useRouter();

  function navigate(next: Partial<{ client: string; aFrom: string; aTo: string; bFrom: string; bTo: string }>) {
    const values = { client: selectedClient, aFrom, aTo, bFrom, bTo, ...next };
    const params = new URLSearchParams({ tab: "compare" });
    if (values.client) params.set("client", values.client);
    if (values.aFrom) params.set("aFrom", values.aFrom);
    if (values.aTo) params.set("aTo", values.aTo);
    if (values.bFrom) params.set("bFrom", values.bFrom);
    if (values.bTo) params.set("bTo", values.bTo);
    router.push(`/?${params.toString()}`);
  }

  const dateInputClass =
    "rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Period A (before)</span>
        <input type="date" value={aFrom} onChange={(e) => navigate({ aFrom: e.target.value })} className={dateInputClass} />
        <span className="text-zinc-500">–</span>
        <input type="date" value={aTo} onChange={(e) => navigate({ aTo: e.target.value })} className={dateInputClass} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-zinc-500">Period B (after)</span>
        <input type="date" value={bFrom} onChange={(e) => navigate({ bFrom: e.target.value })} className={dateInputClass} />
        <span className="text-zinc-500">–</span>
        <input type="date" value={bTo} onChange={(e) => navigate({ bTo: e.target.value })} className={dateInputClass} />
      </div>
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
