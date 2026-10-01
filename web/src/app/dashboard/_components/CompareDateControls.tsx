"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

// Two layouts, chosen purely from whether any period field has been set
// yet (derived from the URL, not local state, so it stays consistent on
// refresh/share): a big, centered picker when nothing's picked yet -- the
// range picker IS the page at that point, so it should look like it --
// collapsing to a small bar once the user has started, so it stops
// competing with the results for attention.
export default function CompareDateControls() {
  const router = useRouter();
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
    router.push(`${pathname}?${params.toString()}`);
  }

  function reset() {
    const params = new URLSearchParams(searchParams.toString());
    ["aFrom", "aTo", "bFrom", "bTo"].forEach((k) => params.delete(k));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (!hasStarted) {
    const bigInput =
      "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 focus:border-sky-500 focus:outline-none";
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <h2 className="mb-8 text-lg font-semibold text-zinc-50">Compare two periods</h2>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Period A (before)</span>
            <div className="flex items-center gap-2">
              <input type="date" value={aFrom} onChange={(e) => navigate({ aFrom: e.target.value })} className={bigInput} />
              <span className="text-zinc-600">–</span>
              <input type="date" value={aTo} onChange={(e) => navigate({ aTo: e.target.value })} className={bigInput} />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Period B (after)</span>
            <div className="flex items-center gap-2">
              <input type="date" value={bFrom} onChange={(e) => navigate({ bFrom: e.target.value })} className={bigInput} />
              <span className="text-zinc-600">–</span>
              <input type="date" value={bTo} onChange={(e) => navigate({ bTo: e.target.value })} className={bigInput} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const inputClass =
    "rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-zinc-500">A</span>
        <input type="date" value={aFrom} onChange={(e) => navigate({ aFrom: e.target.value })} className={inputClass} />
        <span className="text-zinc-700">–</span>
        <input type="date" value={aTo} onChange={(e) => navigate({ aTo: e.target.value })} className={inputClass} />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-zinc-500">B</span>
        <input type="date" value={bFrom} onChange={(e) => navigate({ bFrom: e.target.value })} className={inputClass} />
        <span className="text-zinc-700">–</span>
        <input type="date" value={bTo} onChange={(e) => navigate({ bTo: e.target.value })} className={inputClass} />
      </div>
      <button onClick={reset} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
        <X size={12} /> reset
      </button>
    </div>
  );
}
