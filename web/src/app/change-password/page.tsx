import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import ChangePasswordForm from "./ChangePasswordForm";

// Outside /dashboard on purpose: the dashboard layout sends anyone who still
// has a temporary password here, so this page can't sit behind that check.
export default async function ChangePasswordPage() {
  const profile = await getCurrentProfile(await createClient());
  if (!profile) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 text-zinc-50">
      <div className="w-full max-w-sm">
        <p className="mb-1 text-sm font-medium tracking-wide text-accent">CURIOUS APES</p>
        <h1 className="mb-6 text-xl font-semibold">
          {profile.must_change_password ? "Choose your password" : "Change password"}
        </h1>
        <ChangePasswordForm forced={profile.must_change_password} />
        {!profile.must_change_password && (
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-zinc-500 hover:text-zinc-300">
            Back to dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
