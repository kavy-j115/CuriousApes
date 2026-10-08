import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { SHOP_DOMAIN_PATTERN, verifyShopifyHmac, verifyState } from "@/lib/shopifyOAuth";
import { expiringTokensEnabled, getShopifyClientSecret, shopifyEnv, storeShopifyToken, type TokenBundle } from "@/lib/shopifyConfig";

// Shopify redirects the store owner here after they approve the install.
// Deliberately reachable without a login (proxy.ts exempts it) -- the person
// clicking Install is the client's store owner, not one of our users. Trust
// comes from Shopify's HMAC on the query string plus our own signed `state`,
// never from a session. The token is never logged or put in a response.

function page(title: string, message: string, status: number) {
  const html = `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font-family:system-ui,sans-serif;background:#09090b;color:#e4e4e7;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="max-width:28rem;padding:2rem;text-align:center"><h1 style="font-size:1.25rem;margin:0 0 .5rem">${title}</h1><p style="color:#a1a1aa;margin:0">${message}</p></div></body>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shop = params.get("shop") ?? "";
  const code = params.get("code") ?? "";
  const state = params.get("state") ?? "";

  if (!SHOP_DOMAIN_PATTERN.test(shop) || !code || !state) {
    return page("Invalid request", "This link is missing information. Ask the agency for a new install link.", 400);
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
  const verified = verifyState(state, secret);
  if (!verified) {
    return page("Link expired", "This install link is invalid or has expired. Ask the agency for a new one.", 400);
  }

  const admin = getAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("shopify_store_domain")
    .eq("client_id", verified.clientId)
    .maybeSingle();
  if (!client?.shopify_store_domain || client.shopify_store_domain.toLowerCase() !== shop.toLowerCase()) {
    return page("Wrong store", "This link was issued for a different store.", 400);
  }

  let token: string | TokenBundle | undefined;
  let grantedScopes = "";
  try {
    const { clientId } = shopifyEnv();
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, code, expiring: expiringTokensEnabled() ? 1 : 0 }),
    });
    if (!response.ok) {
      return page("Install failed", "Shopify rejected the request. Ask the agency for a new install link.", 502);
    }
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      scope?: string;
    };
    grantedScopes = body.scope ?? "";
    if (body.expires_in || body.refresh_token) {
      // A short-lived token is only acceptable once the app is public and the pipeline
      // refreshes tokens (SHOPIFY_EXPIRING_TOKENS=1); otherwise it would silently stop
      // working an hour later, so refuse it rather than store it.
      if (!expiringTokensEnabled() || !body.access_token || !body.refresh_token) {
        return page("Setup problem", "Shopify issued a short-lived token, which the agency's system isn't set up for yet.", 502);
      }
      token = {
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresIn: Number(body.expires_in ?? 3600),
        refreshExpiresIn: Number(body.refresh_token_expires_in ?? 7776000),
      };
    } else {
      token = body.access_token;
    }
  } catch {
    return page("Install failed", "Couldn't reach Shopify. Please try the link again.", 502);
  }

  if (!token) return page("Install failed", "Shopify didn't return an access token.", 502);

  try {
    await storeShopifyToken(verified.clientId, token);
    // Shopify lists the scopes it granted; read_all_orders lifts the 60-day limit on order history.
    await admin
      .from("clients")
      .update({ all_orders_access: grantedScopes.split(",").map((x) => x.trim()).includes("read_all_orders") })
      .eq("client_id", verified.clientId);
  } catch {
    return page("Install failed", "The connection couldn't be saved. Please contact the agency.", 500);
  }

  return page("Connected", "Your store is now connected. You can close this tab.", 200);
}
