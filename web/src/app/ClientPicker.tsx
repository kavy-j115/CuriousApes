"use client";

import { useRouter } from "next/navigation";

type Client = { client_id: string; display_name: string };

export default function ClientPicker({
  clients,
  selected,
}: {
  clients: Client[];
  selected: string;
}) {
  const router = useRouter();

  return (
    <select
      className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      value={selected}
      onChange={(e) => {
        const value = e.target.value;
        router.push(value === "all" ? "/" : `/?client=${value}`);
      }}
    >
      <option value="all">All clients</option>
      {clients.map((c) => (
        <option key={c.client_id} value={c.client_id}>
          {c.display_name}
        </option>
      ))}
    </select>
  );
}
