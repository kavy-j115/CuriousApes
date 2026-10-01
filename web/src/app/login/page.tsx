import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { ROLE_THEME } from "@/lib/roleTheme";
import type { Role } from "@/lib/auth/profile";

const ROLES: Role[] = ["client", "user", "admin"];

export default function LoginSelectorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-8 font-sans">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-sm font-medium tracking-wide text-lime-400">CURIOUS APES</p>
        <h1 className="mb-2 text-3xl font-semibold text-zinc-50">Welcome back.</h1>
        <p className="mb-8 text-sm text-zinc-400">Choose your account type to continue.</p>

        <div className="flex flex-col gap-3">
          {ROLES.map((role) => {
            const theme = ROLE_THEME[role];
            const Icon = theme.icon;
            return (
              <Link
                key={role}
                href={`/login/${role}`}
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 transition-colors hover:border-zinc-700"
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-md ${theme.iconBg}`}>
                  <Icon size={16} strokeWidth={2.5} />
                </span>
                <span className="flex-1 text-sm font-semibold uppercase tracking-wide text-zinc-100">
                  {theme.label}
                </span>
                <ChevronRight size={18} className="text-zinc-600" />
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
