import { Bell } from "lucide-react";
import ClientDropdown from "./ClientDropdown";
import ProfileMenu from "./ProfileMenu";
import type { Profile } from "@/lib/auth/profile";

type Client = { client_id: string; display_name: string };

export default function TopBar({
  profile,
  clients,
  children,
}: {
  profile: Profile;
  clients: Client[];
  children?: React.ReactNode; // the mobile menu button, passed in from DashboardShell
}) {
  // Client role is RLS-scoped to exactly one client already -- showing a
  // one-option dropdown would be misleading UI (implies there's a choice),
  // so it's hidden for that role rather than rendered disabled.
  const showClientDropdown = profile.role !== "client" && clients.length > 0;

  return (
    <header className="flex h-14 items-center justify-between gap-3 border-b border-zinc-900 bg-black px-4 sm:justify-end sm:px-6">
      {children}
      <div className="flex items-center gap-3">
        {showClientDropdown && <ClientDropdown clients={clients} />}
        <button className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200">
          <Bell size={18} />
        </button>
        <ProfileMenu profile={profile} />
      </div>
    </header>
  );
}
