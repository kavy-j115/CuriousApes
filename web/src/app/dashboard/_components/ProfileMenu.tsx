"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { logout } from "@/app/login/actions";
import { ROLE_THEME } from "@/lib/roleTheme";
import type { Profile } from "@/lib/auth/profile";

export default function ProfileMenu({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const theme = ROLE_THEME[profile.role];
  const initial = (profile.display_name || profile.email || "?").charAt(0).toUpperCase();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-900"
      >
        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${theme.iconBg}`}>
          {initial}
        </span>
        <span className="text-sm text-zinc-200">{profile.display_name || profile.email}</span>
        <ChevronDown size={14} className="text-zinc-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-zinc-800 bg-zinc-950 p-1 shadow-lg">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-zinc-100">{profile.display_name || "—"}</p>
            <p className="truncate text-xs text-zinc-500">{profile.email}</p>
            <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${theme.badge}`}>
              {theme.label}
            </span>
          </div>
          <div className="my-1 border-t border-zinc-900" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event("start-tour"));
            }}
            className="w-full rounded px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Take the tour
          </button>
          <form action={logout}>
            <button
              type="submit"
              className="w-full rounded px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-900"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
