import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { login } from "../actions";
import { ROLE_THEME } from "@/lib/roleTheme";
import type { Role } from "@/lib/auth/profile";
import PasswordField from "./PasswordField";

const VALID_ROLES: Role[] = ["client", "user", "admin"];

export default async function RoleLoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ role: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { role } = await params;
  const { error } = await searchParams;

  if (!VALID_ROLES.includes(role as Role)) {
    notFound();
  }

  const theme = ROLE_THEME[role as Role];
  const Icon = theme.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-8 font-sans">
      <div className="w-full max-w-sm">
        <Link href="/login" className="mb-6 flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300">
          <ArrowLeft size={14} /> Back
        </Link>

        <div className="flex flex-col items-center text-center">
          <span className={`mb-4 flex h-14 w-14 items-center justify-center rounded-full ${theme.iconBg}`}>
            <Icon size={26} strokeWidth={2.25} />
          </span>
          <h1 className="text-xl font-semibold text-zinc-50">{theme.label} Login</h1>
          <p className="mt-1 mb-6 text-sm text-zinc-500">{theme.tagline}</p>
        </div>

        {error && (
          <p className="mb-4 rounded border border-red-900 bg-red-950/60 p-3 text-sm text-red-300">{error}</p>
        )}

        <form action={login} className="flex flex-col gap-4">
          <input type="hidden" name="role" value={role} />

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Email / Username</label>
            <input
              name="email"
              type="email"
              required
              placeholder="Enter your email"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Password</label>
            <PasswordField />
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-500">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" name="remember" className="rounded border-zinc-700 bg-zinc-950" />
              Remember me
            </label>
            <span>Forgot password?</span>
          </div>

          <button
            type="submit"
            className={`mt-2 w-full rounded-md px-4 py-2.5 text-sm font-semibold transition-colors ${theme.button}`}
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
