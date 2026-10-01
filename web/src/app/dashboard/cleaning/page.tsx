import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import CleaningClient from "./CleaningClient";

export default async function CleaningPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin", "user"]);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">Cleaning</h1>
      <CleaningClient />
    </div>
  );
}
