"use server";

import { revalidatePath } from "next/cache";
import { getSupabase, getProfile } from "@/lib/dashboardData";
import { getAdminClient } from "@/lib/supabase/admin";

// Collab = temporary (24h) access to a client, for a colleague. Who may do
// what is decided here on the server, never by which buttons are shown:
//   - client accounts: never (they aren't part of the agency)
//   - agency users: only for clients they hold PERMANENT access to (so a
//     temporary collab can't be passed along in a chain), and only to other
//     agency users (role "user"), never to a client account
//   - admins: any client, same recipient rule
// client_access has no write policy for non-admins, so writes go through the
// service role AFTER these checks pass.

type Caller = { id: string; role: "admin" | "user" };

async function requireAgency(): Promise<Caller> {
  const profile = await getProfile();
  if (!profile || (profile.role !== "admin" && profile.role !== "user")) {
    throw new Error("Only agency admins and users can manage collab access.");
  }
  return { id: profile.id, role: profile.role };
}

async function canShareClient(caller: Caller, clientId: string): Promise<boolean> {
  if (caller.role === "admin") return true;
  const { data } = await getAdminClient()
    .from("client_access")
    .select("client_id")
    .eq("user_id", caller.id)
    .eq("client_id", clientId)
    .is("expires_at", null)
    .maybeSingle();
  return !!data;
}

export async function shareClientWithUser(
  clientId: string,
  targetUserId: string
): Promise<{ ok: true } | { error: string }> {
  const caller = await requireAgency();
  if (targetUserId === caller.id) return { error: "Pick a colleague, not yourself." };
  if (!(await canShareClient(caller, clientId))) return { error: "You can only share clients you have permanent access to." };

  const admin = getAdminClient();
  const { data: target } = await admin.from("user_profiles").select("role").eq("id", targetUserId).maybeSingle();
  if (!target || target.role !== "user") return { error: "Collab can only be given to agency users." };

  // Never overwrite a permanent grant with an expiring one.
  const { data: existing } = await admin
    .from("client_access")
    .select("expires_at")
    .eq("user_id", targetUserId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (existing && !existing.expires_at) return { error: "They already have permanent access to this client." };

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin
    .from("client_access")
    .upsert({ user_id: targetUserId, client_id: clientId, expires_at: expiresAt }, { onConflict: "user_id,client_id" });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/collab");
  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/clients");
  return { ok: true };
}

// Only ever removes EXPIRING rows -- permanent access is managed by admins.
export async function revokeShare(clientId: string, targetUserId: string): Promise<{ ok: true } | { error: string }> {
  const caller = await requireAgency();
  if (!(await canShareClient(caller, clientId))) return { error: "You can only manage clients you have permanent access to." };

  const { error } = await getAdminClient()
    .from("client_access")
    .delete()
    .eq("user_id", targetUserId)
    .eq("client_id", clientId)
    .not("expires_at", "is", null);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/collab");
  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/clients");
  return { ok: true };
}

// Data for the Collab page, assembled with the same rules: only the caller's
// shareable clients, only agency-user recipients, only live grants.
export async function loadCollabData() {
  const caller = await requireAgency();
  const supabase = await getSupabase();
  const admin = getAdminClient();

  const { data: visible } = await supabase.from("clients").select("client_id, display_name").is("paused_at", null).order("display_name");
  let clients = visible ?? [];
  if (caller.role === "user") {
    const { data: permanent } = await admin
      .from("client_access")
      .select("client_id")
      .eq("user_id", caller.id)
      .is("expires_at", null);
    const ids = new Set((permanent ?? []).map((r) => r.client_id));
    clients = clients.filter((c) => ids.has(c.client_id));
  }

  const { data: colleagues } = await admin
    .from("user_profiles")
    .select("id, email, display_name")
    .eq("role", "user")
    .neq("id", caller.id)
    .order("display_name");

  const clientIds = clients.map((c) => c.client_id);
  const { data: grants } = clientIds.length
    ? await admin
        .from("client_access")
        .select("user_id, client_id, expires_at")
        .in("client_id", clientIds)
        .gt("expires_at", new Date().toISOString())
    : { data: [] };

  return {
    clients,
    colleagues: (colleagues ?? []).map((u) => ({ id: u.id as string, label: (u.display_name || u.email || u.id) as string })),
    grants: (grants ?? []).map((g) => ({ user_id: g.user_id as string, client_id: g.client_id as string, expires_at: g.expires_at as string })),
  };
}
