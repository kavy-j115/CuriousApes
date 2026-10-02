import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { SHOP_DOMAIN_PATTERN, buildInstallUrl, signState, verifyShopifyHmac } from "@/lib/shopifyOAuth";
import { getShopifyClientSecret, redirectUri, shopifyEnv } from "@/lib/shopifyConfig";

// This is the app's "App URL". After a store owner opens Shopify's
// custom-distribution install link and picks their store, Shopify redirects
// here (with shop + a signature) and expects the app to start the
// authorization. We verify the signature, look the store up in our clients
// table, and forward to Shopify's authorize page with our signed state --
// so Shopify's link alone completes the whole install, no second link.
// Reachable without a login (proxy.ts exempts it): trust comes from
// Shopify's HMAC plus the store having been added as a client by an admin.

function page(title: string, message: string, status: number) {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1><p style="color:#a1a1aa;margin:0">${message}</p></div></body>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shop = params.get("shop") ?? "";

  if (!SHOP_DOMAIN_PATTERN.test(shop)) {
    return page("Invalid request", "This page is opened by Shopify during an app install.", 400);
  }

  let secret: string;
  try {
    secret = await getShopifyClientSecret();
  } catch {
    return page("Not configured", "The agency hasn't finished setting this up yet. Please contact them.", 500);
  }

  if (!verifyShopifyHmac(params, secret)) {
    return page("Invalid request", "This request couldn't be verified.", 400);
  }

  const { data: client } = await getAdminClient()
    .from("clients")
    .select("client_id")
    .ilike("shopify_store_domain", shop)
    .maybeSingle();
  if (!client) {
    return page("Store not registered", "This store hasn't been set up by the agency yet. Please contact them.", 404);
  }

  try {
    const { clientId, scopes } = shopifyEnv();
    return NextResponse.redirect(
      buildInstallUrl({ shop, clientId, scopes, redirectUri: redirectUri(), state: signState(client.client_id, secret) })
    );
  } catch {
    return page("Not configured", "The agency hasn't finished setting this up yet. Please contact them.", 500);
  }
}
