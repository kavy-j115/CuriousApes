"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

type Client = { client_id: string; display_name: string };

// Same dropdown lives in the top bar across every dashboard page, so
// switching clients here preserves whatever other query params (date
// ranges, view toggles) the current page already has set -- copy the
// existing searchParams forward, only overwrite `client`.
export default function ClientDropdown({ clients }: { clients: Client[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = searchParams.get("client") ?? clients[0]?.client_id ?? "";

  if (clients.length === 0) return null;

  function handleChange(clientId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("client", clientId);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <select
      value={selected}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 focus:border-zinc-600 focus:outline-none"
    >
      {clients.map((c) => (
        <option key={c.client_id} value={c.client_id}>
          {c.display_name}
        </option>
      ))}
    </select>
  );
}
