import { redirect } from "next/navigation";
import { getProfile } from "@/lib/dashboardData";
import { loadCollabData } from "./actions";
import CollabPanel from "./CollabPanel";

export default async function CollabPage() {
  const profile = await getProfile();
  if (!profile) return null; // dashboard/layout.tsx already redirects this case
  // Client accounts aren't part of the agency: no access to this page at all.
  if (profile.role === "client") redirect("/dashboard");

  const { clients, colleagues, grants } = await loadCollabData();

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-zinc-50">Collab</h1>
      <CollabPanel clients={clients} colleagues={colleagues} grants={grants} />
    </div>
  );
}
