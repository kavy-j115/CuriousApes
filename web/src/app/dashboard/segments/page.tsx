import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import SegmentsApp from "./SegmentsApp";

export default async function SegmentsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null; // dashboard/layout.tsx already redirects this case
  assertRole(profile, ["admin", "user"]);

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">Campaign Segment Export</h1>
      <SegmentsApp />
    </div>
  );
}
