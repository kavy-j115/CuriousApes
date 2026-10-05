"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useNav } from "./NavProgress";
import { ChevronDown, Search, Check } from "lucide-react";
import { SELECTED_CLIENT_COOKIE } from "@/lib/selectedClientCookie";

type Client = { client_id: string; display_name: string };

function readCookieClient(): string | null {
  if (typeof document === "undefined") return null; // SSR pass, no cookie access
  const match = document.cookie.match(new RegExp(`(?:^|; )${SELECTED_CLIENT_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Kept as a plain module-level function (not inlined into the event
// handler) -- the React Compiler's eslint rules flag a direct `document.*=`
// write inside a component that also uses hooks as a possible render-purity
// violation, even though this one only ever runs from a click handler.
function writeCookieClient(clientId: string): void {
  document.cookie = `${SELECTED_CLIENT_COOKIE}=${encodeURIComponent(clientId)}; path=/; max-age=31536000`;
}

// Same dropdown lives in the top bar across every dashboard page, so
// switching clients here preserves whatever other query params (date
// ranges, view toggles) the current page already has set -- copy the
// existing searchParams forward, only overwrite `client`.
export default function ClientDropdown({
  clients,
  initialSelectedClient,
}: {
  clients: Client[];
  initialSelectedClient: string;
}) {
  const { navigate } = useNav();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = searchParams.get("client");

  // Sidebar links don't carry ?client=, so on a page reached that way this
  // falls back to the cookie. Read fresh on every render rather than once
  // via useState -- this component lives in the persistent dashboard
  // layout and doesn't remount on client-side navigation, so a one-time
  // read would go stale the moment the user picked a client and then
  // followed a sidebar link. On the very first hydration render, though,
  // the DOM already shows `initialSelectedClient` (computed server-side
  // from the same cookie, passed down from layout.tsx) -- React
  // deliberately skips reconciling a controlled form value during
  // hydration itself (the same allowance that protects browser autofill
  // from being clobbered), so matching the server's value here, rather
  // than only computing the right value client-side and hoping React
  // applies it, is what actually makes the first paint correct.
  const cookieClient = readCookieClient();

  const selected = queryClient ?? cookieClient ?? initialSelectedClient ?? clients[0]?.client_id ?? "";
  const selectedClientObj = clients.find((c) => c.client_id === selected);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
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

  if (clients.length === 0) return null;

  function handleChange(clientId: string) {
    writeCookieClient(clientId);
    const params = new URLSearchParams(searchParams.toString());
    params.set("client", clientId);
    navigate(`${pathname}?${params.toString()}`);
    setOpen(false);
    setQuery("");
  }

  const filtered = query.trim()
    ? clients.filter((c) => c.display_name.toLowerCase().includes(query.trim().toLowerCase()))
    : clients;

  return (
    <div ref={rootRef} data-tour="client-dropdown" className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:border-zinc-700 focus:border-accent focus:outline-none"
      >
        {selectedClientObj?.display_name ?? "Select client"}
        <ChevronDown size={14} className="text-zinc-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 shadow-lg">
          {clients.length > 6 && (
            <div className="flex items-center gap-1.5 border-b border-zinc-900 px-2.5 py-2">
              <Search size={13} className="shrink-0 text-zinc-500" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search clients"
                className="w-full bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-64 overflow-y-auto scrollbar-thin py-1">
            {filtered.length === 0 && <p className="px-3 py-2 text-sm text-zinc-500">No matches</p>}
            {filtered.map((c) => (
              <button
                key={c.client_id}
                type="button"
                onClick={() => handleChange(c.client_id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-900 ${
                  c.client_id === selected ? "text-accent" : "text-zinc-200"
                }`}
              >
                {c.display_name}
                {c.client_id === selected && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
