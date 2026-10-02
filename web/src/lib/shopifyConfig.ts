import { getAdminClient } from "@/lib/supabase/admin";

// The app's client secret lives in Supabase Vault (not a web env var), so
// the Python pipeline and this web app read one copy. Store it once with:
//   venv/Scripts/python scripts/set_vault_secret.py agency.shopify.client_secret
const CLIENT_SECRET_NAME = "agency.shopify.client_secret";

export function tokenSecretName(clientId: string): string {
  return `${clientId}.shopify.access_token`;
}

export function shopifyEnv(): { clientId: string; scopes: string; siteUrl: string } {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const siteUrl = process.env.SITE_URL;
  if (!clientId || !siteUrl) {
    throw new Error("SHOPIFY_CLIENT_ID and SITE_URL must be set to use Shopify onboarding.");
  }
  return {
    clientId,
    siteUrl: siteUrl.replace(/\/+$/, ""),
    scopes: process.env.SHOPIFY_SCOPES ?? "read_orders,read_customers,read_products",
  };
}

export function redirectUri(): string {
  return `${shopifyEnv().siteUrl}/api/shopify/callback`;
}

export async function getShopifyClientSecret(): Promise<string> {
  const { data, error } = await getAdminClient().rpc("get_vault_secret", { p_name: CLIENT_SECRET_NAME });
  if (error || !data) {
    throw new Error(`Shopify client secret isn't stored in Vault yet (secret name: ${CLIENT_SECRET_NAME}).`);
  }
  return data as string;
}

export async function storeShopifyToken(clientId: string, token: string): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.rpc("set_vault_secret", {
    p_name: tokenSecretName(clientId),
    p_value: token,
    p_description: `Shopify Admin API token for ${clientId} (installed via OAuth)`,
  });
  if (error) throw new Error("Couldn't store the Shopify token in Vault.");
  await admin.from("clients").update({ shopify_connected_at: new Date().toISOString() }).eq("client_id", clientId);
}
