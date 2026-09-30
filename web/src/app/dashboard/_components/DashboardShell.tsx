"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import type { Profile } from "@/lib/auth/profile";

type Client = { client_id: string; display_name: string };

// Below the `lg` breakpoint the sidebar becomes an overlay drawer instead
// of a permanent column -- a fixed 14rem sidebar left always-open on a
// 375px phone would leave barely any room for actual content.
export default function DashboardShell({
  profile,
  clients,
  children,
}: {
  profile: Profile;
  clients: Client[];
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer automatically on navigation -- otherwise it stays
  // open over the new page after tapping a link. Adjusting state during
  // render (the documented pattern for "reset state when a prop changes")
  // rather than in an effect, which would cause an extra render pass.
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setNavOpen(false);
  }

  return (
    <div className="flex min-h-screen bg-black text-zinc-50">
      <div className="hidden lg:block">
        <Sidebar role={profile.role} />
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0">
            <Sidebar role={profile.role} />
          </div>
          <button
            onClick={() => setNavOpen(false)}
            aria-label="Close menu"
            className="absolute right-3 top-3 rounded-md p-2 text-zinc-400 hover:bg-zinc-900"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar profile={profile} clients={clients}>
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200 lg:hidden"
          >
            <Menu size={20} />
          </button>
        </TopBar>
        <main className="flex-1 overflow-x-auto bg-zinc-950 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
