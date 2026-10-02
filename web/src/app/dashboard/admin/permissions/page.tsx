import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, assertRole } from "@/lib/auth/profile";
import { ROLE_THEME } from "@/lib/roleTheme";
import type { Role } from "@/lib/auth/profile";

export default async function AdminPermissionsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return null;
  assertRole(profile, ["admin"]);

  const [{ data: clients }, { data: profiles }, { data: access }] = await Promise.all([
    supabase.from("clients").select("client_id, display_name").order("display_name"),
    supabase.from("user_profiles").select("id, email, display_name, role").order("role"),
    supabase.from("client_access").select("user_id, client_id"),
  ]);

  const accessByUser = new Map<string, string[]>();
  for (const row of access ?? []) {
    const list = accessByUser.get(row.user_id) ?? [];
    const client = clients?.find((c) => c.client_id === row.client_id);
    if (client) list.push(client.display_name);
    accessByUser.set(row.user_id, list);
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 text-xl font-semibold text-zinc-50">Permissions</h1>
      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Client access</th>
            </tr>
          </thead>
          <tbody>
            {(profiles ?? []).map((p) => {
              const theme = ROLE_THEME[p.role as Role];
              const clientNames = accessByUser.get(p.id as string) ?? [];
              return (
                <tr key={p.id} className="border-b border-zinc-900 text-zinc-300">
                  <td className="px-3 py-2">
                    <p className="text-zinc-100">{p.display_name || "—"}</p>
                    <p className="text-xs text-zinc-500">{p.email}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${theme.badge}`}>{theme.label}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.role === "admin" ? "All clients" : clientNames.length > 0 ? clientNames.join(", ") : "— none assigned —"}
                  </td>
                </tr>
              );
            })}
            {(profiles ?? []).length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-zinc-500">No users yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
