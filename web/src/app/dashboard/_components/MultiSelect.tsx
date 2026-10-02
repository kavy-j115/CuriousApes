"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import Checkbox from "./Checkbox";

export type MultiOption = { id: string; label: string; hint?: string };

// A dropdown of checkboxes for picking several items from a list (a user's
// clients, a client's users). Controlled: the parent owns `selected` and
// decides when to save.
export default function MultiSelect({
  placeholder,
  options,
  selected,
  onChange,
  className = "",
}: {
  placeholder: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? options.filter((o) => selected.includes(o.id)).map((o) => o.label).join(", ")
        : `${selected.length} selected`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-48 max-w-xs items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-700 focus:border-accent focus:outline-none"
      >
        <span className={`truncate ${selected.length === 0 ? "text-zinc-500" : ""}`}>{summary}</span>
        <ChevronDown size={14} className="shrink-0 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 w-64 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-lg">
          {options.length > 6 && (
            <div className="flex items-center gap-1.5 border-b border-zinc-900 px-2.5 py-2">
              <Search size={13} className="shrink-0 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">Nothing to choose from</p>}
            {shown.map((o) => (
              <div key={o.id} className="px-3 py-1.5 hover:bg-zinc-900">
                <Checkbox
                  checked={selected.includes(o.id)}
                  onChange={(checked) => onChange(checked ? [...selected, o.id] : selected.filter((x) => x !== o.id))}
                  label={
                    <span className="flex flex-col">
                      <span>{o.label}</span>
                      {o.hint && <span className="text-xs text-zinc-500">{o.hint}</span>}
                    </span>
                  }
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
