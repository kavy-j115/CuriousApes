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

// Remembers (per user) that this page's tutorial has been seen, so it never runs
// by itself again -- on any browser or device. Same service-role pattern as
// markTourSeen: always the session user's own row.
export async function markPageTourSeen(path: string): Promise<void> {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile || !path.startsWith("/dashboard")) return;
  try {
    const admin = getAdminClient();
    const seen = new Set(profile.seen_page_tours);
    seen.add(path);
    await admin.from("user_profiles").update({ seen_page_tours: [...seen] }).eq("id", profile.id);
  } catch {
    // worst case the tutorial shows once more
  }
}

// "Skip tour" on the main tour: no automatic page tutorials any more (the sidebar
// Tutorial button still opens one on demand).
export async function disablePageTours(): Promise<void> {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return;
  try {
    await getAdminClient().from("user_profiles").update({ page_tours_disabled: true }).eq("id", profile.id);
  } catch {
    // nothing more to do
  }
}
