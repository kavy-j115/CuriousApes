"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV, ADMIN_NAV } from "./nav";
import type { Role } from "@/lib/auth/profile";

// Active-nav-item styling here used to come from ROLE_THEME (orange for
// admin, sky for user, lime for client) -- distinct per role, but it meant
// every admin page glowed orange, every client page glowed green, on top
// of the app's other ad hoc colors. One fixed accent now, everywhere;
// ROLE_THEME still exists for the login screens, where role-distinction
// actually matters.
const ACTIVE_LINK_CLASS = "bg-accent/10 text-accent border-current font-medium";

export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();

  const items = MAIN_NAV.filter((item) => item.roles.includes(role));
  const adminItems = ADMIN_NAV.filter((item) => item.roles.includes(role));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-900 bg-zinc-950 px-3 py-4">
      <div className="mb-6 border-b border-zinc-900 px-2 pb-4">
        <p className="text-sm font-bold leading-none text-zinc-50">CURIOUS</p>
        <p className="text-sm font-bold leading-none text-accent">APES</p>
      </div>

      <nav className="flex flex-col gap-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = !item.external && pathname === item.href;
          return (
            <Link
              key={item.label}
              href={item.href}
              data-tour={`nav-${item.label}`}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener noreferrer" : undefined}
              className={`flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-all ${
                active
                  ? ACTIVE_LINK_CLASS
                  : "border-transparent text-zinc-400 hover:translate-x-0.5 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {adminItems.length > 0 && (
        <>
          <p className="mb-1 mt-6 px-3 text-[10px] font-semibold tracking-wider text-zinc-600">
            ADMINISTRATION
          </p>
          <nav className="flex flex-col gap-0.5">
            {adminItems.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  data-tour={`nav-${item.label}`}
                  className={`flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-all ${
                    active
                      ? ACTIVE_LINK_CLASS
                      : "border-transparent text-zinc-400 hover:translate-x-0.5 hover:bg-zinc-900 hover:text-zinc-100"
                  }`}
                >
                  <Icon size={16} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </>
      )}
    </aside>
  );
}
