"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar } from "lucide-react";

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthStart(): string {
  return `${isoDaysAgo(0).slice(0, 8)}01`;
}

const PRESETS: { label: string; from: () => string; to: () => string }[] = [
  { label: "Today", from: () => isoDaysAgo(0), to: () => isoDaysAgo(0) },
  { label: "7D", from: () => isoDaysAgo(6), to: () => isoDaysAgo(0) },
  { label: "30D", from: () => isoDaysAgo(29), to: () => isoDaysAgo(0) },
  { label: "90D", from: () => isoDaysAgo(89), to: () => isoDaysAgo(0) },
];

// Client selection lives in the top bar's ClientDropdown now, so this only
// handles the date range -- copies the existing searchParams forward
// (preserving `client`, `view`, etc.) rather than rebuilding the query
// string from scratch.
export default function ReportDateControls({ defaultRange = "month" }: { defaultRange?: "month" | "30d" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [customOpen, setCustomOpen] = useState(false);

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  // With nothing in the URL the page shows its default range -- this month on
  // Reports, the last 30 days on the dashboard -- so that button reads as active.
  const activePreset =
    PRESETS.find((p) => p.from() === from && p.to() === to)?.label ?? (!from && !to && defaultRange === "30d" ? "30D" : null);
  // No range in the URL = the default "this month so far" view.
  const isThisMonth = !from && !to && defaultRange === "month";

  function navigate(next: { from?: string; to?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (f) params.set("from", f);
    else params.delete("from");
    if (t) params.set("to", t);
    else params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
  }

  const inputClass =
    "rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 focus:border-zinc-600 focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-full bg-zinc-900 p-1">
        <button
          onClick={() => {
            setCustomOpen(false);
            navigate({ from: monthStart(), to: isoDaysAgo(0) });
          }}
          className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            (isThisMonth || (from === monthStart() && to === isoDaysAgo(0))) && !customOpen ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          This month
        </button>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setCustomOpen(false);
              navigate({ from: p.from(), to: p.to() });
            }}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              activePreset === p.label && !customOpen
                ? "bg-accent text-white"
                : "text-zinc-400 hover:text-zinc-100"
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setCustomOpen((v) => !v)}
          className={`flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
            customOpen || (from && !activePreset)
              ? "bg-accent text-white"
              : "text-zinc-400 hover:text-zinc-100"
          }`}
        >
          <Calendar size={14} /> Custom
        </button>
      </div>

      {(customOpen || (from && !activePreset)) && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1">
          <input type="date" value={from} onChange={(e) => navigate({ from: e.target.value })} className={inputClass} aria-label="From date" />
          <span className="text-zinc-600">–</span>
          <input type="date" value={to} onChange={(e) => navigate({ to: e.target.value })} className={inputClass} aria-label="To date" />
          {(from || to) && (
            <button
              onClick={() => {
                setCustomOpen(false);
                navigate({ from: "", to: "" });
              }}
              className="text-xs text-zinc-500 hover:underline"
            >
              clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
