"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";
import type { ReportConfig } from "@/lib/reportColumns";

// Defense in depth, not the real gate: every admin page already calls
// assertRole(profile, ["admin"]) before rendering, so a non-admin can't
// reach a form that calls one of these actions in the first place. This
// re-checks anyway, the same way api/reports/[clientId] never trusts that
// only the "right" caller could have hit it.
async function requireAdmin() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile || profile.role !== "admin") {
    throw new Error("Admin access required.");
  }
  return { supabase, profile };
}

export async function createClientRecord(formData: FormData) {
  const { supabase } = await requireAdmin();
  const client_id = (formData.get("client_id") as string)?.trim();
  const display_name = (formData.get("display_name") as string)?.trim();
  if (!client_id || !display_name) throw new Error("client_id and display_name are required.");

  // Alert thresholds + WhatsApp recipients can be set right away at
  // creation, or left blank and filled in later from the same row's
  // "notifications" editor -- see updateClientNotifications() below. Both
  // write to the same two columns (sql/018_client_notifications.sql).
  const revenue = formData.get("revenue_change_pct");
  const cac = formData.get("cac_change_pct");
  const roas = formData.get("roas_change_pct");
  const thresholds: Record<string, number> = {};
  if (revenue) thresholds.revenue_change_pct = Number(revenue);
  if (cac) thresholds.cac_change_pct = Number(cac);
  if (roas) thresholds.roas_change_pct = Number(roas);

  const recipients = (formData.get("whatsapp_recipients") as string)
    ?.split(",")
    .map((p) => p.trim())
    .filter(Boolean) ?? [];

  const { error } = await supabase.from("clients").insert({
    client_id,
    display_name,
    alert_thresholds: Object.keys(thresholds).length > 0 ? thresholds : null,
    whatsapp_recipients: recipients,
  });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/clients");
}

// Edits an existing client's thresholds/recipients -- the same two
// sql/018_client_notifications.sql columns createClientRecord() can set
// at creation time, just editable afterward too.
export async function updateClientNotifications(
  clientId: string,
  thresholds: { revenue_change_pct?: number; cac_change_pct?: number; roas_change_pct?: number } | null,
  whatsappRecipients: string[]
) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("clients")
    .update({ alert_thresholds: thresholds, whatsapp_recipients: whatsappRecipients })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/clients");
}

// `config: null` resets the client to the app's default column set/order/
// ROAS thresholds (clears report_config back to NULL) -- see
// sql/015_report_config.sql.
export async function updateClientReportConfig(clientId: string, config: ReportConfig) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("clients")
    .update({ report_config: config })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/clients");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/reports");
  revalidatePath("/dashboard/comparisons");
}

// Postgres itself is the real safety net here: clients is referenced
// (without CASCADE) by orders/customers/raw_*/alerts/etc., so deleting a
// client that still has synced data fails with a foreign-key error rather
// than silently taking everything down with it. That error is surfaced to
// the admin as-is, not swallowed.
export async function deleteClientRecord(clientId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("clients").delete().eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/clients");
}

// Full removal needs the service role (Auth Admin API) -- deleting the
// auth.users row cascades to user_profiles and client_access automatically
// (see sql/011_auth_and_rls.sql's ON DELETE CASCADE). Without a service
// role key configured, this falls back to deleting just the user_profiles
// row: RLS-reachable with the session client alone, which locks them out
// of the app (getCurrentProfile() returns null, layout redirects to
// /login) without touching their actual Supabase Auth account -- a real
// but partial removal, stated as such rather than silently claiming full
// deletion.
export async function deleteUserRecord(userId: string): Promise<{ fullyDeleted: boolean }> {
  const { supabase, profile } = await requireAdmin();
  if (userId === profile.id) throw new Error("Can't delete your own account.");

  try {
    const admin = getAdminClient();
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/admin/users");
    revalidatePath("/dashboard/admin/permissions");
    return { fullyDeleted: true };
  } catch {
    const { error } = await supabase.from("user_profiles").delete().eq("id", userId);
    if (error) throw new Error(error.message);
    revalidatePath("/dashboard/admin/users");
    revalidatePath("/dashboard/admin/permissions");
    return { fullyDeleted: false };
  }
}

// Creates a real Supabase Auth account (needs the service role key --
// there's no RLS-sanctioned way to do this with the session client, this
// is the one genuinely privileged operation in this file) plus its
// user_profiles row, then grants whatever clients were checked at
// creation time. Returns the auto-generated temporary password so the
// caller can show it ONCE -- it is never stored anywhere, and there's no
// way to retrieve it again after this call returns (matches this
// project's "never persist a credential outside Vault" stance).
export async function createUser(formData: FormData) {
  await requireAdmin();

  const email = (formData.get("email") as string)?.trim();
  const display_name = (formData.get("display_name") as string)?.trim();
  const role = formData.get("role") as string;
  const clientIds = formData.getAll("client_ids") as string[];

  if (!email || !["admin", "user", "client"].includes(role)) {
    throw new Error("email and a valid role are required.");
  }

  const admin = getAdminClient();
  const tempPassword = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(createError?.message ?? "Failed to create the account.");
  }

  const { error: profileError } = await admin
    .from("user_profiles")
    .insert({ id: created.user.id, role, display_name: display_name || null, email });
  if (profileError) throw new Error(profileError.message);

  if (clientIds.length > 0) {
    const { error: accessError } = await admin
      .from("client_access")
      .insert(clientIds.map((client_id) => ({ user_id: created.user!.id, client_id })));
    if (accessError) throw new Error(accessError.message);
  }

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");

  return { email, tempPassword };
}

export async function updateUserRole(userId: string, role: string) {
  const { supabase } = await requireAdmin();
  if (!["admin", "user", "client"].includes(role)) throw new Error("Invalid role.");

  const { error } = await supabase.from("user_profiles").update({ role }).eq("id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");
}

// Collab feature: grants `clientId` to `userId` for 24 hours (e.g. covering
// for someone who's out) instead of a permanent assignment. Expiry is
// enforced by has_client_access() itself (sql/016_collab_and_admin_delete.sql)
// -- nothing needs to run to "turn this off" at the 24-hour mark, it just
// stops granting access the moment expires_at passes.
export async function grantTemporaryAccess(userId: string, clientId: string) {
  const { supabase } = await requireAdmin();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from("client_access")
    .upsert({ user_id: userId, client_id: clientId, expires_at: expiresAt }, { onConflict: "user_id,client_id" });
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");
}

// Moves a client's single assignment from whoever currently has it (any
// 'client'-role user with a permanent client_access row for it) to a
// different user in one step, instead of the admin having to remember to
// uncheck it on the old user's row AND check it on the new one.
// newUserId: null just unassigns.
export async function reassignClient(clientId: string, newUserId: string | null) {
  const { supabase } = await requireAdmin();

  const { error: deleteError } = await supabase
    .from("client_access")
    .delete()
    .eq("client_id", clientId)
    .is("expires_at", null);
  if (deleteError) throw new Error(deleteError.message);

  if (newUserId) {
    const { error: insertError } = await supabase
      .from("client_access")
      .insert({ user_id: newUserId, client_id: clientId });
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath("/dashboard/admin/clients");
  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");
}

export async function revokeAccess(userId: string, clientId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("client_access").delete().eq("user_id", userId).eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");
}

// Replaces a user's PERMANENT client_access rows -- simpler and less
// error-prone than diffing added/removed clients for what's always a small
// list, at the cost of a delete+insert instead of a true diff. Only
// touches rows with expires_at IS NULL, so saving the permanent list here
// never clobbers an active collab grant (grantTemporaryAccess/revokeAccess
// own those separately).
export async function setUserClientAccess(userId: string, clientIds: string[]) {
  const { supabase } = await requireAdmin();

  const { error: deleteError } = await supabase
    .from("client_access")
    .delete()
    .eq("user_id", userId)
    .is("expires_at", null);
  if (deleteError) throw new Error(deleteError.message);

  if (clientIds.length > 0) {
    const { error: insertError } = await supabase
      .from("client_access")
      .insert(clientIds.map((client_id) => ({ user_id: userId, client_id })));
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");
}
