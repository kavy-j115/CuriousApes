"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";

// Marks the CURRENT user's tour as seen. Uses the service role because
// user_profiles has no self-update RLS policy -- but the row updated is
// always the session user's own id, never one passed in by the caller.
// Failing quietly is deliberate: worst case the tour shows once more.
export async function markTourSeen(): Promise<void> {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return;
  try {
    await getAdminClient().from("user_profiles").update({ has_seen_tour: true }).eq("id", profile.id);
  } catch {
    // service role not configured -- nothing more to do
  }
}
