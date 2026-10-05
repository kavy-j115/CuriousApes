"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useNav } from "./NavProgress";
import { X } from "lucide-react";

type Range = { aFrom: string; aTo: string; bFrom: string; bTo: string };

const iso = (d: Date) => new Intl.DateTimeFormat("en-CA").format(d);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// One-click period pairs. A is always the earlier ("before") period and B the
// later one; "this month" is compared like-for-like with the same number of
// days of last month, so a half-finished month isn't set against a full one.
const PRESETS: { label: string; range: () => Range }[] = [
  {
    label: "Yesterday vs day before",
    range: () => {
      const t = addDays(new Date(), -1); // last complete day
      return { aFrom: iso(addDays(t, -2)), aTo: iso(addDays(t, -2)), bFrom: iso(addDays(t, -1)), bTo: iso(addDays(t, -1)) };
    },
  },
  {
    label: "Last 7 days vs previous 7",
    range: () => {
      const t = addDays(new Date(), -1); // last complete day
      return { aFrom: iso(addDays(t, -13)), aTo: iso(addDays(t, -7)), bFrom: iso(addDays(t, -6)), bTo: iso(t) };
    },
  },
  {
    label: "Last 30 days vs previous 30",
    range: () => {
      const t = addDays(new Date(), -1); // last complete day
      return { aFrom: iso(addDays(t, -59)), aTo: iso(addDays(t, -30)), bFrom: iso(addDays(t, -29)), bTo: iso(t) };
    },
  },
  {
    label: "This month vs last month",
    range: () => {
      const t = addDays(new Date(), -1); // last complete day
      const prevStart = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const prevLength = new Date(t.getFullYear(), t.getMonth(), 0).getDate();
      const prevEnd = new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(t.getDate(), prevLength));
      return { aFrom: iso(prevStart), aTo: iso(prevEnd), bFrom: iso(new Date(t.getFullYear(), t.getMonth(), 1)), bTo: iso(t) };
    },
  },
];

// Two layouts, chosen purely from whether any period field has been set
// yet (derived from the URL, not local state, so it stays consistent on
// refresh/share): a big, centered picker when nothing's picked yet -- the
// range picker IS the page at that point, so it should look like it --
// collapsing to a small bar once the user has started, so it stops
// competing with the results for attention.
export default function CompareDateControls() {
  const { navigate: nav } = useNav();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const aFrom = searchParams.get("aFrom") ?? "";
  const aTo = searchParams.get("aTo") ?? "";
  const bFrom = searchParams.get("bFrom") ?? "";
  const bTo = searchParams.get("bTo") ?? "";
  const hasStarted = !!(aFrom || aTo || bFrom || bTo);

  function navigate(next: Partial<{ aFrom: string; aTo: string; bFrom: string; bTo: string }>) {
    const params = new URLSearchParams(searchParams.toString());
    const values = { aFrom, aTo, bFrom, bTo, ...next };
    (Object.entries(values) as [string, string][]).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    nav(`${pathname}?${params.toString()}`);
  }

  function applyPreset(range: Range) {
    navigate(range);
  }

  const presetChips = (
    <div className="flex flex-wrap justify-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => applyPreset(p.range())}
          className="rounded-full border border-zinc-800 px-3 py-1 text-xs text-zinc-300 hover:border-accent hover:text-accent"
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  function reset() {
    const params = new URLSearchParams(searchParams.toString());
    ["aFrom", "aTo", "bFrom", "bTo"].forEach((k) => params.delete(k));
    nav(`${pathname}?${params.toString()}`);
  }

  if (!hasStarted) {
    const bigInput =
      "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 focus:border-accent focus:outline-none";
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h2 className="mb-5 text-lg font-semibold text-zinc-50">Compare two periods</h2>
        <div className="mb-8">{presetChips}</div>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Period A (before)</span>
            <div className="flex items-center gap-2">
              <input type="date" max={iso(addDays(new Date(), -1))} value={aFrom} onChange={(e) => navigate({ aFrom: e.target.value })} className={bigInput} />
              <span className="text-zinc-600">–</span>
              <input type="date" max={iso(addDays(new Date(), -1))} value={aTo} onChange={(e) => navigate({ aTo: e.target.value })} className={bigInput} />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Period B (after)</span>
            <div className="flex items-center gap-2">
              <input type="date" max={iso(addDays(new Date(), -1))} value={bFrom} onChange={(e) => navigate({ bFrom: e.target.value })} className={bigInput} />
              <span className="text-zinc-600">–</span>
              <input type="date" max={iso(addDays(new Date(), -1))} value={bTo} onChange={(e) => navigate({ bTo: e.target.value })} className={bigInput} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const inputClass =
    "rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200 focus:border-accent focus:outline-none";

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
      <div className="flex justify-start">{presetChips}</div>
      <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-zinc-500">A</span>
        <input type="date" max={iso(addDays(new Date(), -1))} value={aFrom} onChange={(e) => navigate({ aFrom: e.target.value })} className={inputClass} />
        <span className="text-zinc-700">–</span>
        <input type="date" max={iso(addDays(new Date(), -1))} value={aTo} onChange={(e) => navigate({ aTo: e.target.value })} className={inputClass} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-zinc-500">B</span>
        <input type="date" max={iso(addDays(new Date(), -1))} value={bFrom} onChange={(e) => navigate({ bFrom: e.target.value })} className={inputClass} />
        <span className="text-zinc-700">–</span>
        <input type="date" max={iso(addDays(new Date(), -1))} value={bTo} onChange={(e) => navigate({ bTo: e.target.value })} className={inputClass} />
      </div>
      <button onClick={reset} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
        <X size={12} /> reset
      </button>
      </div>
    </div>
  );
}
