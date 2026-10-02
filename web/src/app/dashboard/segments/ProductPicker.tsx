"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

// Searchable multi-select over the product titles found in the uploaded file.
export default function ProductPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = options.filter((o) => !selected.includes(o) && (!q || o.toLowerCase().includes(q))).slice(0, 8);

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-zinc-400">{label}</p>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">
              {s}
              <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(selected.filter((x) => x !== s))} className="hover:text-white">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative max-w-md">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-accent focus:outline-none"
        />
      </div>
      {matches.length > 0 && (
        <ul className="mt-1.5 max-w-md overflow-hidden rounded-md border border-zinc-900 bg-zinc-950">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                onClick={() => {
                  onChange([...selected, m]);
                  setQuery("");
                }}
                className="block w-full truncate px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-900"
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
      {options.length === 0 && <p className="mt-1.5 text-xs text-zinc-500">No products found in this file.</p>}
    </div>
  );
}
