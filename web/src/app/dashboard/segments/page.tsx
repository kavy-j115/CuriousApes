import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import SegmentsApp from "./SegmentsApp";
import SamplePreview from "./SamplePreview";

export default async function SegmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null; // dashboard/layout.tsx already redirects this case
  assertRole(profile, ["admin", "user"]);

  const { data: clients } = await supabase.from("clients").select("client_id").order("display_name");
  const selectedClient = client ?? clients?.[0]?.client_id ?? "";

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold text-zinc-50">Campaign Segment Export</h1>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <SegmentsApp clientId={selectedClient} />
        <SamplePreview />
      </div>
    </div>
  );
}
