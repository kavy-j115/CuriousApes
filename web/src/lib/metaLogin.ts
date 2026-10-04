import { getAdminClient } from "@/lib/supabase/admin";

// "Connect Meta": Facebook Login on the agency's Meta app. An agency person logs
// in once; the long-lived token (about 60 days) is kept in Vault and can read
// every ad account that person can reach (their own and partner-shared ones).
// Clients are then mapped to ad accounts on the Meta Accounts page. Non-secret
// settings come from env; the app secret is read from Vault (the same Meta app's
// secret already stored for the WhatsApp webhook is reused unless
// agency.meta.app_secret is set).

export const GRAPH_VERSION = "v24.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export function metaLoginEnv(): { appId: string; scopes: string; siteUrl: string } {
  const appId = process.env.META_APP_ID;
  const siteUrl = process.env.SITE_URL;
  if (!appId || !siteUrl) throw new Error("META_APP_ID and SITE_URL must be set to use Connect Meta.");
  return {
    appId,
    siteUrl: siteUrl.replace(/\/+$/, ""),
    scopes: process.env.META_LOGIN_SCOPES ?? "ads_read,business_management",
  };
}

export const metaRedirectUri = () => `${metaLoginEnv().siteUrl}/api/meta/callback`;

async function vaultSecret(name: string): Promise<string | null> {
  const { data, error } = await getAdminClient().rpc("get_vault_secret", { p_name: name });
  return error || !data ? null : (data as string);
}

export async function getMetaAppSecret(): Promise<string> {
  const secret = (await vaultSecret("agency.meta.app_secret")) ?? (await vaultSecret("agency.whatsapp.app_secret"));
  if (!secret) throw new Error("The Meta app secret isn't stored in Vault yet (agency.meta.app_secret).");
  return secret;
}

export function buildMetaLoginUrl(state: string): string {
  const { appId, scopes } = metaLoginEnv();
  const query = new URLSearchParams({
    client_id: appId,
    redirect_uri: metaRedirectUri(),
    state,
    scope: scopes,
    response_type: "code",
  });
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${query.toString()}`;
}

async function graphJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!response.ok) throw new Error(`Meta returned HTTP ${response.status}.`);
  return (await response.json()) as T;
}

export type MetaAdAccount = { account_id: string; name: string; business_name: string | null; account_status: number | null };

/** Code from the login redirect -> a long-lived user token and who it belongs to. */
export async function completeLogin(code: string): Promise<{
  token: string;
  expiresAt: string | null;
  fbUserId: string;
  fbUserName: string | null;
}> {
  const { appId } = metaLoginEnv();
  const secret = await getMetaAppSecret();

  const short = await graphJson<{ access_token?: string }>(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: secret, redirect_uri: metaRedirectUri(), code })}`
  );
  if (!short.access_token) throw new Error("Meta didn't return an access token.");

  const long = await graphJson<{ access_token?: string; expires_in?: number }>(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: secret,
      fb_exchange_token: short.access_token,
    })}`
  );
  const token = long.access_token ?? short.access_token;
  const expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null;

  const me = await graphJson<{ id: string; name?: string }>(`${GRAPH}/me?fields=id,name`, token);
  return { token, expiresAt, fbUserId: me.id, fbUserName: me.name ?? null };
}

/** Every ad account the token can reach (follows Meta's paging). */
export async function fetchAdAccounts(token: string): Promise<MetaAdAccount[]> {
  const accounts: MetaAdAccount[] = [];
  let url: string | null = `${GRAPH}/me/adaccounts?${new URLSearchParams({ fields: "account_id,name,account_status,business{name}", limit: "200" })}`;
  for (let page = 0; url && page < 20; page++) {
    const body: { data?: { account_id: string; name?: string; account_status?: number; business?: { name?: string } }[]; paging?: { next?: string } } =
      await graphJson(url, token);
    for (const a of body.data ?? []) {
      accounts.push({
        account_id: a.account_id,
        name: a.name ?? a.account_id,
        business_name: a.business?.name ?? null,
        account_status: a.account_status ?? null,
      });
    }
    url = body.paging?.next ?? null;
  }
  return accounts;
}

/** Saves the token in Vault and the connection + its ad accounts in the tables. */
export async function saveConnection(login: Awaited<ReturnType<typeof completeLogin>>, accounts: MetaAdAccount[]): Promise<void> {
  const admin = getAdminClient();
  const secretName = `agency.meta_user.${login.fbUserId}.access_token`;
  const { error: vaultError } = await admin.rpc("set_vault_secret", {
    p_name: secretName,
    p_value: login.token,
    p_description: `Meta Facebook Login token for ${login.fbUserName ?? login.fbUserId}`,
  });
  if (vaultError) throw new Error("Couldn't store the Meta token in Vault.");

  const { data: connection, error } = await admin
    .from("meta_connections")
    .upsert(
      {
        fb_user_id: login.fbUserId,
        fb_user_name: login.fbUserName,
        secret_name: secretName,
        expires_at: login.expiresAt,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: "fb_user_id" }
    )
    .select("id")
    .single();
  if (error || !connection) throw new Error("Couldn't save the Meta connection.");

  await replaceAccounts(connection.id as string, accounts);
}

/** Replaces this connection's account list with the one Meta just returned. */
export async function replaceAccounts(connectionId: string, accounts: MetaAdAccount[]): Promise<void> {
  const admin = getAdminClient();
  if (accounts.length > 0) {
    const { error } = await admin.from("meta_ad_accounts").upsert(
      accounts.map((a) => ({ ...a, connection_id: connectionId, last_seen_at: new Date().toISOString() })),
      { onConflict: "account_id" }
    );
    if (error) throw new Error("Couldn't save the ad accounts.");
  }
  const keep = accounts.map((a) => a.account_id);
  const query = admin.from("meta_ad_accounts").delete().eq("connection_id", connectionId);
  const { error: staleError } = keep.length > 0 ? await query.not("account_id", "in", `(${keep.join(",")})`) : await query;
  if (staleError) throw new Error("Couldn't clear old ad accounts.");
}

export async function getConnectionToken(secretName: string): Promise<string | null> {
  return vaultSecret(secretName);
}
