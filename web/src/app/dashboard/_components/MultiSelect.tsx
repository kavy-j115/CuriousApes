"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";
import Checkbox from "./Checkbox";

export type MultiOption = { id: string; label: string; hint?: string };

// A searchable dropdown for picking several items from a list (a user's clients, a
// client's users). Controlled: the parent owns `selected` and decides when to save.
// `single` makes it a one-choice picker that closes as soon as an item is chosen.
//
// The list is drawn in a portal on the page itself, so it is never cut off by a card
// that clips its contents (the client and user cards do), and a "Done" button closes it.
export default function MultiSelect({
  placeholder,
  options,
  selected,
  onChange,
  single = false,
  unit,
  className = "",
}: {
  placeholder: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
  /** Word for one item ("client", "user"): a multi-select then shows a count such as "3 clients". */
  unit?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setQuery("");
  }

  // Sit just under the button; follow it if the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 256);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      setPos({ left: Math.max(8, left), top: r.bottom + 6, width });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q)) : options;
  // A single pick shows its name; a multi-select shows how many are picked, never the list.
  const chosen = selected.filter((id) => options.some((o) => o.id === id));
  const summary =
    chosen.length === 0
      ? placeholder
      : single
        ? options.filter((o) => chosen.includes(o.id)).map((o) => o.label).join(", ")
        : unit
          ? `${chosen.length} ${unit}${chosen.length === 1 ? "" : "s"}`
          : `${chosen.length} selected`;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex w-full min-w-48 max-w-xs items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-left text-sm text-zinc-200 transition-colors hover:border-zinc-700 focus:border-accent focus:outline-none"
      >
        <span className={`truncate ${chosen.length === 0 ? "text-zinc-500" : ""}`}>{summary}</span>
        <ChevronDown size={14} className="shrink-0 text-zinc-500" />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}
            className="z-[110] overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-lg"
          >
            <div className="flex items-center gap-1.5 border-b border-zinc-900 px-2.5 py-2">
              <Search size={13} className="shrink-0 text-zinc-500" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
              {shown.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">{options.length === 0 ? "Nothing to choose from" : "No match"}</p>}
              {shown.map((o) =>
                single ? (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => {
                      onChange([o.id]);
                      close();
                    }}
                    className={`flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-zinc-900 ${selected.includes(o.id) ? "text-accent" : "text-zinc-200"}`}
                  >
                    <span>{o.label}</span>
                    {o.hint && <span className="text-xs text-zinc-500">{o.hint}</span>}
                  </button>
                ) : (
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
                )
              )}
            </div>
            {!single && (
              <div className="flex items-center justify-between border-t border-zinc-900 px-3 py-2">
                <span className="text-xs text-zinc-500">{chosen.length} selected</span>
                <button type="button" onClick={close} className="rounded bg-accent px-3 py-1 text-xs font-medium text-white">
                  Done
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
