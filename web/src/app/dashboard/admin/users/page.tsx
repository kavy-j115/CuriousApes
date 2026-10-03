import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole, type Role } from "@/lib/auth/profile";
import CreateUserForm from "./CreateUserForm";
import UserRow from "./UserRow";

export default async function AdminUsersPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, { data: profiles }, { data: access }] = await Promise.all([
    supabase.from("clients").select("client_id, display_name").order("display_name"),
    // Agency people only -- client logins are created and shown on the Clients page.
    supabase.from("user_profiles").select("id, email, display_name, role").in("role", ["admin", "user"]).order("created_at"),
    supabase.from("client_access").select("user_id, client_id, expires_at"),
  ]);

  const accessByUser = new Map<string, { client_id: string; expires_at: string | null }[]>();
  for (const row of access ?? []) {
    const list = accessByUser.get(row.user_id) ?? [];
    list.push({ client_id: row.client_id, expires_at: row.expires_at });
    accessByUser.set(row.user_id, list);
  }

  const users = (profiles ?? []).map((p) => ({
    id: p.id as string,
    email: p.email as string | null,
    display_name: p.display_name as string | null,
    role: p.role as Role,
    access: accessByUser.get(p.id as string) ?? [],
  }));

  // Other agency users (role "user") who have permanent clients -- the people
  // you can "collab with". Client accounts aren't part of the agency.
  const collabCandidates = users
    .filter((u) => u.role === "user" && u.access.some((a) => !a.expires_at))
    .map((u) => ({ id: u.id, label: u.display_name || u.email || u.id }));

  return (
    <div className="max-w-3xl">
      <h1 className="mb-4 text-xl font-semibold text-zinc-50">Users</h1>

      <CreateUserForm clients={clients ?? []} />

      <div className="flex flex-col gap-3">
        {users.map((u) => (
          <UserRow key={u.id} user={u} clients={clients ?? []} collabCandidates={collabCandidates} currentUserId={profile.id} />
        ))}
        {users.length === 0 && <p className="text-sm text-zinc-500">No users yet.</p>}
      </div>
    </div>
  );
}
