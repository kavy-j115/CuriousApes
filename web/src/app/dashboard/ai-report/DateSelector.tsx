"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

export default function DateSelector({ dates }: { dates: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get("date") ?? dates[0] ?? "";

  function handleChange(date: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", date);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (dates.length === 0) return null;

  return (
    <select
      value={selected}
      onChange={(e) => handleChange(e.target.value)}
      className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200"
    >
      {dates.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </select>
  );
}
