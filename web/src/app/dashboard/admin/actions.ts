"use server";

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";
import type { ReportConfig } from "@/lib/reportColumns";
import { buildInstallUrl, signState } from "@/lib/shopifyOAuth";
import { normalizeConnections } from "@/lib/clientConnections";
import { getShopifyClientSecret, redirectUri, shopifyEnv } from "@/lib/shopifyConfig";
import { buildMetaLoginUrl, fetchAdAccounts, getConnectionToken, getMetaAppSecret, replaceAccounts } from "@/lib/metaLogin";

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
  input: { shopifyStoreDomain: string; ga4PropertyId: string }
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
// ---- Connect Meta (agency Facebook login) ----

// Link that opens Facebook's login for the signed-in admin. Nothing is fetched
// from Meta until the person approves.
export async function createMetaLoginLink(): Promise<{ url: string } | { error: string }> {
  await requireAdmin();
  try {
    return { url: buildMetaLoginUrl(signState("meta-connect", await getMetaAppSecret())) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't start the Meta login." };
  }
}

// One ad account belongs to one client: linking it clears any earlier client.
export async function mapAdAccount(accountId: string, clientId: string | null) {
  const { supabase } = await requireAdmin();
  const { error: clearError } = await supabase.from("clients").update({ meta_ad_account_id: null }).eq("meta_ad_account_id", accountId);
  if (clearError) throw new Error(clearError.message);
  if (clientId) {
    const { error } = await supabase.from("clients").update({ meta_ad_account_id: accountId }).eq("client_id", clientId);
    if (error) throw new Error(error.message);
  }
  revalidatePath("/dashboard/admin/meta");
  revalidatePath("/dashboard/admin/clients");
}

// Re-reads each connection's ad accounts from Meta (new accounts shared with the
// agency show up, removed ones disappear). Manual only -- nothing runs this
// automatically, and nothing is paused or deleted because of what it finds: it
// reports which accounts are new and which linked clients lost their account, and
// the admin decides.
export type MetaRefreshResult = { added: string[]; removed: number; paused: { id: string; name: string }[]; tooMany: boolean };

// If more clients than this lose their account in one refresh it looks like a Meta
// problem, not clients leaving, so nothing is paused.
const MAX_AUTO_PAUSE = 2;

export async function refreshMetaAccounts(): Promise<MetaRefreshResult> {
  await requireAdmin();
  const admin = getAdminClient();
  const { data: before } = await admin.from("meta_ad_accounts").select("account_id");
  const beforeIds = new Set((before ?? []).map((a) => a.account_id as string));

  const { data: connections } = await admin.from("meta_connections").select("id, secret_name, fb_user_name");
  for (const c of connections ?? []) {
    const token = await getConnectionToken(c.secret_name as string);
    if (!token) throw new Error(`The saved token for ${c.fb_user_name ?? "a profile"} is missing -- reconnect it.`);
    const accounts = await fetchAdAccounts(token);
    await replaceAccounts(c.id as string, accounts);
    await admin.from("meta_connections").update({ refreshed_at: new Date().toISOString() }).eq("id", c.id);
  }

  const { data: after } = await admin.from("meta_ad_accounts").select("account_id");
  const afterIds = new Set((after ?? []).map((a) => a.account_id as string));
  const added = [...afterIds].filter((id) => !beforeIds.has(id));
  const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));

  // Linked clients whose ad account is no longer visible. Fetching stops for them
  // (a pause: history and credentials are kept, nothing is touched on Meta's side)
  // and an alert asks the admin to remove them from the client list if they have
  // left. Deleting is never automatic.
  let lost: { id: string; name: string }[] = [];
  if (removedIds.length > 0) {
    const { data } = await admin
      .from("clients")
      .select("client_id, display_name")
      .in("meta_ad_account_id", removedIds)
      .is("paused_at", null);
    lost = (data ?? []).map((c) => ({ id: c.client_id as string, name: c.display_name as string }));
  }

  const tooMany = lost.length > MAX_AUTO_PAUSE;
  const paused = tooMany ? [] : lost;
  const today = new Date().toISOString().slice(0, 10);
  for (const c of paused) {
    await admin
      .from("clients")
      .update({ paused_at: new Date().toISOString(), sync_enabled: false, pause_reason: "meta_access_lost" })
      .eq("client_id", c.id);
    // Saved as already "notified" so the WhatsApp dispatcher never sends this to the
    // client's own numbers -- it is an alert for us, shown on the Clients page.
    await admin.from("alerts").upsert(
      {
        client_id: c.id,
        alert_date: today,
        alert_type: "client_access_lost",
        message: `${c.name}: the agency Meta login can no longer see this client's ad account. Fetching is stopped and the client is hidden. If they have left the agency, remove them from the client list.`,
        notified_at: new Date().toISOString(),
      },
      { onConflict: "client_id,alert_date,alert_type" }
    );
  }

  revalidatePath("/dashboard", "layout");
  return { added, removed: removedIds.length, paused, tooMany };
}

export async function removeMetaConnection(connectionId: string) {
  await requireAdmin();
  const admin = getAdminClient();
  const { data: connection } = await admin.from("meta_connections").select("secret_name").eq("id", connectionId).maybeSingle();
  if (!connection) throw new Error("Connection not found.");
  await admin.rpc("delete_vault_secret", { p_name: connection.secret_name });
  const { error } = await admin.from("meta_connections").delete().eq("id", connectionId);
  if (error) throw new Error(error.message);
  revalidatePath("/dashboard/admin/meta");
}

// Disconnect = pause. The client disappears from every screen and nothing is
// fetched, but its credentials and stored history are kept, so it can be
// reconnected later. (Deleting the client is the permanent option below.)
export async function pauseClient(clientId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase
    .from("clients")
    .update({ paused_at: new Date().toISOString(), sync_enabled: false, pause_reason: null })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard", "layout");
}

// Reconnect: fetching resumes, and the next daily run backfills the days that
// were missed while paused (from the day before it was paused).
export async function resumeClient(clientId: string) {
  const { supabase } = await requireAdmin();
  const { data: client, error: readError } = await supabase
    .from("clients")
    .select("paused_at, backfill_from")
    .eq("client_id", clientId)
    .maybeSingle();
  if (readError || !client) throw new Error(readError?.message ?? "Client not found.");

  let backfillFrom: string | null = (client.backfill_from as string | null) ?? null;
  if (client.paused_at) {
    const d = new Date(client.paused_at as string);
    d.setUTCDate(d.getUTCDate() - 1);
    const pausedDay = d.toISOString().slice(0, 10);
    backfillFrom = backfillFrom && backfillFrom < pausedDay ? backfillFrom : pausedDay;
  }

  const { error } = await supabase
    .from("clients")
    .update({ paused_at: null, sync_enabled: true, backfill_from: backfillFrom, pause_reason: null })
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/dashboard", "layout");
  return { backfillFrom };
}

// ---- "Sync now": the backfill pop-up (shown for a new client once Shopify is
// connected, and when a paused client is reconnected).
//
// Saving the chosen start date is always done (our own database). On a developer
// machine the pipeline for this ONE client is also started right away and its log
// can be followed; in production (no Python on the web server) the date is picked
// up by the next scheduled run instead.
const running = new Map<string, number>(); // client id -> start time, one run per client

function syncLogPath(clientId: string) {
  return path.join(os.tmpdir(), "curious_apes_sync", `${clientId.replace(/[^a-z0-9_-]/gi, "_")}.log`);
}

export async function startClientSync(
  clientId: string,
  fromDate: string
): Promise<{ ok: true; started: boolean } | { error: string }> {
  const { supabase } = await requireAdmin();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return { error: "Pick a valid start date." };
  const day = 86400000;
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const today = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (!(from >= today - 60 * day)) return { error: "Shopify only allows the last 60 days." };
  if (!(from < today)) return { error: "The start date must be before today (today is fetched tomorrow, once it is whole)." };

  const { data: client } = await supabase.from("clients").select("paused_at").eq("client_id", clientId).maybeSingle();
  if (!client) return { error: "Client not found." };
  if (client.paused_at) return { error: "Reconnect the client first." };

  const { error } = await supabase
    .from("clients")
    .update({ backfill_from: fromDate, sync_enabled: true })
    .eq("client_id", clientId);
  if (error) return { error: error.message };
  revalidatePath("/dashboard", "layout");

  if (process.env.NODE_ENV === "production") return { ok: true, started: false };
  if (running.has(clientId)) return { error: "A sync for this client is already running." };

  const root = path.resolve(process.cwd(), "..");
  const python = path.join(root, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (!fs.existsSync(python)) return { ok: true, started: false };
  const logPath = syncLogPath(clientId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const out = fs.openSync(logPath, "w");
  const child = spawn(python, ["-u", "-m", "src.scheduler.run_pipeline", "--client", clientId], {
    cwd: root,
    stdio: ["ignore", out, out],
    // On Windows a detached child gets its own console window; keep it attached and hidden.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  running.set(clientId, Date.now());
  child.on("exit", () => running.delete(clientId));
  child.on("error", () => running.delete(clientId));
  child.unref();
  return { ok: true, started: true };
}

export async function getClientSyncLog(clientId: string): Promise<{ running: boolean; text: string }> {
  await requireAdmin();
  let text = "";
  try {
    text = fs.readFileSync(syncLogPath(clientId), "utf8").slice(-6000);
  } catch {
    /* no run yet */
  }
  return { running: running.has(clientId), text };
}

// Permanent removal for a client that is not coming back: the client, ALL of its
// stored data, its saved credentials in Vault, its report files, and any client
// login that had access to nothing else. Admin only; the caller must also have
// typed the client ID in the UI.
export async function deleteClientRecord(clientId: string) {
  await requireAdmin();
  const admin = getAdminClient();

  // Client logins that only ever had access to this client.
  const { data: access } = await admin.from("client_access").select("user_id").eq("client_id", clientId);
  const candidateIds = (access ?? []).map((a) => a.user_id as string);
  const { data: clientLogins } = candidateIds.length
    ? await admin.from("user_profiles").select("id").eq("role", "client").in("id", candidateIds)
    : { data: [] as { id: string }[] };

  const { error } = await admin.rpc("delete_client_completely", { p_client_id: clientId });
  if (error) throw new Error(error.message);

  // Best-effort cleanup after the database part succeeded.
  for (const login of clientLogins ?? []) {
    const { count } = await admin.from("client_access").select("user_id", { count: "exact", head: true }).eq("user_id", login.id);
    if (!count) await admin.auth.admin.deleteUser(login.id as string);
  }
  try {
    const storage = admin.storage.from("reports");
    const paths: string[] = [];
    const walk = async (prefix: string) => {
      const { data } = await storage.list(prefix, { limit: 1000 });
      for (const item of data ?? []) {
        const full = `${prefix}/${item.name}`;
        if (item.id) paths.push(full);
        else await walk(full);
      }
    };
    await walk(clientId);
    if (paths.length) await storage.remove(paths);
  } catch {
    // report files left behind are harmless; the database part is what matters
  }

  revalidatePath("/dashboard", "layout");
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
// Changing an admin's role (or making someone an admin) and deleting an admin are
// the most powerful things this app can do, so they need the password of ANY admin
// account typed again, on top of being signed in as an admin. The password is
// checked against each admin's login on a throwaway client (no session is created
// or replaced). Five wrong tries from one admin lock the check for ten minutes.
const failedAdminChecks = new Map<string, { count: number; blockedUntil: number }>();

async function assertAdminPassword(actingAdminId: string, password: string | undefined): Promise<void> {
  const state = failedAdminChecks.get(actingAdminId);
  if (state && state.blockedUntil > Date.now()) throw new Error("Too many wrong passwords. Try again in a few minutes.");
  if (!password) throw new Error("Enter an admin password to confirm this.");

  const { data: admins } = await getAdminClient().from("user_profiles").select("email").eq("role", "admin");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase isn't configured for password checks.");

  for (const a of admins ?? []) {
    if (!a.email) continue;
    const plain = createPlainClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await plain.auth.signInWithPassword({ email: a.email as string, password });
    if (!error) {
      failedAdminChecks.delete(actingAdminId);
      return;
    }
  }
  const count = (state?.count ?? 0) + 1;
  failedAdminChecks.set(actingAdminId, count >= 5 ? { count: 0, blockedUntil: Date.now() + 10 * 60 * 1000 } : { count, blockedUntil: 0 });
  throw new Error("That isn't an admin account's password.");
}

async function adminCount(): Promise<number> {
  const { count } = await getAdminClient().from("user_profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
  return count ?? 0;
}

export async function deleteUserRecord(userId: string, adminPassword?: string): Promise<{ fullyDeleted: boolean }> {
  const { supabase, profile } = await requireAdmin();
  if (userId === profile.id) throw new Error("Can't delete your own account.");

  const { data: target } = await supabase.from("user_profiles").select("role").eq("id", userId).maybeSingle();
  if (target?.role === "admin") {
    await assertAdminPassword(profile.id, adminPassword);
    if ((await adminCount()) <= 1) throw new Error("There must always be at least one admin.");
  }

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

export async function updateUserRole(userId: string, role: string, adminPassword?: string) {
  const { supabase, profile } = await requireAdmin();
  if (!["admin", "user"].includes(role)) throw new Error("Invalid role.");
  if (userId === profile.id) throw new Error("Can't change your own role.");

  const { data: target } = await supabase.from("user_profiles").select("role").eq("id", userId).maybeSingle();
  if (!target) throw new Error("User not found.");
  if (target.role === role) return;
  // Demoting an admin, or promoting someone to admin: needs an admin password.
  if (target.role === "admin" || role === "admin") {
    await assertAdminPassword(profile.id, adminPassword);
    if (target.role === "admin" && (await adminCount()) <= 1) throw new Error("There must always be at least one admin.");
  }

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
