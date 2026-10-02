"use client";

import Select from "../_components/Select";
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
    <Select value={selected} onChange={handleChange}>
      {dates.map((d) => (
        <option key={d} value={d}>{d}</option>
      ))}
    </Select>
  );
}
