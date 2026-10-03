"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";
import type { ReportConfig } from "@/lib/reportColumns";
import { buildInstallUrl, signState } from "@/lib/shopifyOAuth";
import { normalizeConnections } from "@/lib/clientConnections";
import { getShopifyClientSecret, redirectUri, shopifyEnv } from "@/lib/shopifyConfig";

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

export async function createClientRecord(
  formData: FormData
): Promise<{ ok: true; login?: { email: string; tempPassword: string }; loginError?: string } | { error: string }> {
  const { supabase } = await requireAdmin();
  const client_id = (formData.get("client_id") as string)?.trim();
  const display_name = (formData.get("display_name") as string)?.trim();
  if (!client_id || !display_name) return { error: "Client ID and brand name are required." };
  const clientEmail = ((formData.get("client_email") as string) ?? "").trim();
  if (clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) return { error: "Client email doesn't look valid." };

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

  // Ideal ROAS drives the PROAS colour gradient in every report (green at or
  // above it, fading to red as it drops). Kept in report_config.
  const idealRoasRaw = (formData.get("ideal_roas") as string | null)?.trim();
  const idealRoas = idealRoasRaw ? Number(idealRoasRaw) : null;
  if (idealRoas !== null && (!Number.isFinite(idealRoas) || idealRoas <= 0)) return { error: "Ideal ROAS must be a number above 0." };

  let recipients: string[];
  try {
    recipients = ((formData.get("whatsapp_recipients") as string) ?? "")
      .split(",")
      .map((p) => normalizePhone(p))
      .filter((p): p is string => !!p);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid phone number." };
  }

  let connections;
  try {
    connections = normalizeConnections({
      shopifyStoreDomain: formData.get("shopify_store_domain") as string | null,
      metaAdAccountId: formData.get("meta_ad_account_id") as string | null,
      ga4PropertyId: formData.get("ga4_property_id") as string | null,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid connection details." };
  }

  // sync_enabled is left at its database default (false): a new client is
  // never fetched until it's switched on deliberately.
  const { error } = await supabase.from("clients").insert({
    client_id,
    display_name,
    alert_thresholds: Object.keys(thresholds).length > 0 ? thresholds : null,
    whatsapp_recipients: recipients,
    report_config: idealRoas !== null ? { columns: [], idealRoas } : null,
    ...connections,
  });
  if (error) return { error: error.code === "23505" ? "A client with that ID already exists." : error.message };

  // The client's own login (role "client", tied to this one store). If it
  // fails (e.g. that email already has an account) the client record is kept
  // and the problem is reported, rather than silently half-failing.
  let login: { email: string; tempPassword: string } | undefined;
  let loginError: string | undefined;
  if (clientEmail) {
    try {
      login = await createAccount({ email: clientEmail, display_name: display_name, role: "client", clientIds: [client_id] });
    } catch (e) {
      loginError = e instanceof Error ? e.message : "Couldn't create the client's login.";
    }
  }

  revalidatePath("/dashboard/admin/clients");
  revalidatePath("/dashboard/admin/permissions");
  return { ok: true, login, loginError };
}

// Changing the store domain invalidates an earlier connection (the stored
// token belongs to the old store), so connected-at is cleared when it changes.
export async function updateClientConnections(
  clientId: string,
  input: { shopifyStoreDomain: string; metaAdAccountId: string; ga4PropertyId: string }
) {
  const { supabase } = await requireAdmin();
  const next = normalizeConnections(input);
  const { data: current } = await supabase
    .from("clients")
    .select("shopify_store_domain")
    .eq("client_id", clientId)
    .maybeSingle();
  const domainChanged = (current?.shopify_store_domain ?? null) !== next.shopify_store_domain;

  const { error } = await supabase
    .from("clients")
    .update({ ...next, ...(domainChanged ? { shopify_connected_at: null } : {}) })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/clients");
}

export async function setClientSyncEnabled(clientId: string, enabled: boolean) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("clients").update({ sync_enabled: enabled }).eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/clients");
}

// Returns a link to send to the client's store owner. Generating it makes no
// call to Shopify -- it only signs a URL; nothing is fetched until the owner
// opens it and approves.
export async function createShopifyInstallLink(clientId: string): Promise<{ url: string } | { error: string }> {
  const { supabase } = await requireAdmin();
  const { data: client } = await supabase
    .from("clients")
    .select("shopify_store_domain")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!client?.shopify_store_domain) return { error: "Save the store domain first." };

  try {
    const { clientId: appClientId, scopes } = shopifyEnv();
    const secret = await getShopifyClientSecret();
    return {
      url: buildInstallUrl({
        shop: client.shopify_store_domain,
        clientId: appClientId,
        scopes,
        redirectUri: redirectUri(),
        state: signState(clientId, secret),
      }),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create the install link." };
  }
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
// Creates a Supabase Auth account + its profile + (optionally) client access,
// returning a one-time temporary password. Shared by createUser (agency
// staff) and createClientRecord (a client's own login).
// WhatsApp numbers are kept with the country code (digits, optional leading +)
// because the bot matches a sender by the full international number.
function normalizePhone(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 11 || digits.length > 15) throw new Error("Phone numbers need the country code, e.g. +919876543210.");
  return `+${digits}`;
}

function makeTempPassword(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function createAccount(input: {
  email: string;
  display_name: string | null;
  role: "admin" | "user" | "client";
  clientIds: string[];
  phone?: string | null;
}): Promise<{ email: string; tempPassword: string }> {
  const admin = getAdminClient();
  const tempPassword = makeTempPassword();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(createError?.message ?? "Failed to create the account.");
  }

  const { error: profileError } = await admin
    .from("user_profiles")
    .insert({ id: created.user.id, role: input.role, display_name: input.display_name, email: input.email, phone: input.phone ?? null, must_change_password: true });
  if (profileError) throw new Error(profileError.message);

  if (input.clientIds.length > 0) {
    const { error: accessError } = await admin
      .from("client_access")
      .insert(input.clientIds.map((client_id) => ({ user_id: created.user!.id, client_id })));
    if (accessError) throw new Error(accessError.message);
  }

  return { email: input.email, tempPassword };
}

// Agency staff only (admin or user). A client's login is created from the
// Clients page, together with the client itself.
export async function createUser(formData: FormData) {
  await requireAdmin();

  const email = (formData.get("email") as string)?.trim();
  const display_name = (formData.get("display_name") as string)?.trim();
  const role = formData.get("role") as string;
  const clientIds = formData.getAll("client_ids") as string[];
  const phone = normalizePhone(formData.get("phone") as string | null);

  if (!email || !["admin", "user"].includes(role)) {
    throw new Error("email and a valid role (admin or user) are required.");
  }

  const result = await createAccount({
    email,
    display_name: display_name || null,
    role: role as "admin" | "user",
    clientIds: role === "user" ? clientIds : [],
    phone,
  });

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/permissions");

  return result;
}

// Lost or compromised password: sets a new temporary one (shown once to the
// admin to pass on) and forces the person to choose their own at next login.
export async function resetUserPassword(userId: string): Promise<{ tempPassword: string }> {
  const { profile } = await requireAdmin();
  if (userId === profile.id) throw new Error("Use Change password in your profile menu for your own account.");

  const admin = getAdminClient();
  const tempPassword = makeTempPassword();
  const { error } = await admin.auth.admin.updateUserById(userId, { password: tempPassword });
  if (error) throw new Error(error.message);
  const { error: flagError } = await admin.from("user_profiles").update({ must_change_password: true }).eq("id", userId);
  if (flagError) throw new Error(flagError.message);

  return { tempPassword };
}

export async function updateUserPhone(userId: string, phone: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("user_profiles").update({ phone: normalizePhone(phone) }).eq("id", userId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard/admin/users");
}

export async function updateUserRole(userId: string, role: string) {
  const { supabase } = await requireAdmin();
  if (!["admin", "user"].includes(role)) throw new Error("Invalid role.");

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
  const { data: target } = await supabase.from("user_profiles").select("role").eq("id", userId).maybeSingle();
  if (target?.role !== "user") throw new Error("Collab can only be given to agency users.");
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

// Collab with a USER rather than a client: gives `userId` 24-hour access to
// every client `otherUserId` has permanent access to (e.g. covering for a
// colleague who is out). A client `userId` already has permanently is left
// alone -- upserting would overwrite that permanent grant with an expiring one.
export async function grantCollabWithUser(
  userId: string,
  otherUserId: string
): Promise<{ granted: number } | { error: string }> {
  const { supabase } = await requireAdmin();
  if (userId === otherUserId) return { error: "Pick a different user." };
  const { data: roles } = await supabase.from("user_profiles").select("id, role").in("id", [userId, otherUserId]);
  if ((roles ?? []).length !== 2 || (roles ?? []).some((r) => r.role !== "user")) {
    return { error: "Collab is only between agency users." };
  }

  const [{ data: theirs }, { data: mine }] = await Promise.all([
    supabase.from("client_access").select("client_id").eq("user_id", otherUserId).is("expires_at", null),
    supabase.from("client_access").select("client_id, expires_at").eq("user_id", userId),
  ]);
  const alreadyPermanent = new Set((mine ?? []).filter((r) => !r.expires_at).map((r) => r.client_id));
  const toGrant = (theirs ?? []).map((r) => r.client_id).filter((id) => !alreadyPermanent.has(id));
  if (toGrant.length === 0) return { error: "That user has no clients this person doesn't already have." };

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("client_access")
    .upsert(toGrant.map((client_id) => ({ user_id: userId, client_id, expires_at: expiresAt })), { onConflict: "user_id,client_id" });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/users");
  revalidatePath("/dashboard/admin/clients");
  revalidatePath("/dashboard/admin/permissions");
  return { granted: toGrant.length };
}

// The client-side mirror of setUserClientAccess: replaces who has PERMANENT
// access to this client. Active collab (expiring) grants are left untouched.
export async function setClientUserAccess(clientId: string, userIds: string[]) {
  const { supabase } = await requireAdmin();

  // Only AGENCY users' rows are replaced: the client's own login (role
  // "client") keeps its access to its store no matter what is saved here.
  const { data: agencyUsers } = await supabase.from("user_profiles").select("id").eq("role", "user");
  const agencyIds = (agencyUsers ?? []).map((u) => u.id as string);
  const validIds = userIds.filter((id) => agencyIds.includes(id));

  if (agencyIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("client_access")
      .delete()
      .eq("client_id", clientId)
      .is("expires_at", null)
      .in("user_id", agencyIds);
    if (deleteError) throw new Error(deleteError.message);
  }

  if (validIds.length > 0) {
    const { error: insertError } = await supabase
      .from("client_access")
      .insert(validIds.map((user_id) => ({ user_id, client_id: clientId })));
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

  revalidatePath("/dashboard/admin/clients");
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
