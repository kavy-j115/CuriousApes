import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { ensureClientForShop } from "@/lib/shopifyStores";
import { SHOP_DOMAIN_PATTERN, buildInstallUrl, signState, verifyShopifyHmac } from "@/lib/shopifyOAuth";
import { verifySessionToken } from "@/lib/shopifySession";
import { getShopifyClientSecret, redirectUri, shopifyEnv } from "@/lib/shopifyConfig";
import { APP_NAME } from "@/lib/appName";

// The app's home inside the Shopify admin (the App URL's embedded view). A route handler, not a React
// page, so that Shopify's app-bridge.js is the very first script in <head> as Shopify requires, and so
// nothing here depends on third-party cookies (the request is checked with Shopify's session token or
// its signed query string).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function html(body: string, apiKey: string, status = 200) {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="shopify-api-key" content="${esc(apiKey)}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(APP_NAME)}</title>
<style>
body{margin:0;background:#f6f6f7;color:#202223;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border-radius:12px;box-shadow:0 1px 0 rgba(26,26,26,.07),0 0 0 1px rgba(26,26,26,.05);padding:20px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0 0 8px}p{margin:0 0 10px}ul{margin:0 0 4px;padding-left:20px}li{margin-bottom:4px}
.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600}
.ok{background:#cdfee1;color:#0c5132}.wait{background:#ffeab5;color:#5e4200}.off{background:#e4e5e7;color:#44474a}
a{color:#005bd3}.muted{color:#6d7175}.btn{display:inline-block;background:#303030;color:#fff;border-radius:8px;padding:8px 14px;text-decoration:none;font-weight:600}
</style></head><body><div class="wrap">${body}</div></body></html>`;
  return new NextResponse(doc, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Shopify shows the app inside its admin; only that origin may frame it.
      "content-security-policy": "frame-ancestors https://*.myshopify.com https://admin.shopify.com;",
      "cache-control": "no-store",
    },
  });
}

function message(title: string, text: string, apiKey: string, status = 200) {
  return html(`<div class="card"><h1>${esc(title)}</h1><p class="muted">${esc(text)}</p></div>`, apiKey, status);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let apiKey = "";
  let secret = "";
  try {
    apiKey = shopifyEnv().clientId;
    secret = await getShopifyClientSecret();
  } catch {
    return message("Not set up", "This app has not been fully configured yet.", apiKey, 500);
  }

  // Who is asking: Shopify's session token, or its signed query string.
  const token = params.get("id_token");
  let shop = token ? (verifySessionToken(token, secret, apiKey)?.shop ?? "") : "";
  if (!shop) {
    const q = (params.get("shop") ?? "").toLowerCase();
    if (SHOP_DOMAIN_PATTERN.test(q) && verifyShopifyHmac(params, secret)) shop = q;
  }
  if (!shop) return message("Open this app from your Shopify admin", "This page is meant to be opened inside Shopify.", apiKey, 400);

  const admin = getAdminClient();
  const { data: client } = await admin
    .from("clients")
    .select("client_id, display_name, sync_enabled, pending_approval, paused_at, shopify_connected_at")
    .ilike("shopify_store_domain", shop)
    .maybeSingle();

  // Not installed (or the token is missing): authenticate with OAuth first -- breaking out of the
  // Shopify admin frame, which the authorize page cannot be shown inside.
  if (!client || !client.shopify_connected_at) {
    const resolved = await ensureClientForShop(shop);
    if (!resolved) return message("Couldn't start", "Please try again in a moment.", apiKey, 500);
    const { scopes } = shopifyEnv();
    const url = buildInstallUrl({ shop, clientId: apiKey, scopes, redirectUri: redirectUri(), state: signState(resolved.clientId, secret) });
    return html(
      `<div class="card"><h1>Connecting your store</h1><p class="muted">Approve the read-only access on the next screen.</p>
       <p><a class="btn" href="${esc(url)}" target="_top">Continue</a></p></div>
       <script>try{window.open(${JSON.stringify(url)},"_top")}catch(e){}</script>`,
      apiKey
    );
  }

  const { siteUrl } = shopifyEnv();
  const { data: last } = await admin
    .from("shopify_daily_sales")
    .select("fetched_at")
    .eq("client_id", client.client_id as string)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastUpdate = last?.fetched_at ? new Date(last.fetched_at as string).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;

  let badge = '<span class="badge ok">Active</span>';
  let line = "Your store's reports are updated every morning.";
  if (client.paused_at) {
    badge = '<span class="badge off">Paused</span>';
    line = "Reporting for this store is paused.";
  } else if (client.pending_approval) {
    badge = '<span class="badge wait">Setup in progress</span>';
    line = "Your store is connected. Reporting starts once your reporting team has approved it.";
  } else if (!client.sync_enabled) {
    badge = '<span class="badge wait">Connected</span>';
    line = "Your store is connected. Reports start after syncing is switched on.";
  }

  return html(
    `<div class="card"><h1>${esc(APP_NAME)}</h1>
      <p>${badge}</p><p>${esc(line)}</p>
      ${lastUpdate ? `<p class="muted">Latest data update: ${esc(lastUpdate)}</p>` : ""}
      <p><a class="btn" href="${esc(siteUrl)}/login" target="_blank" rel="noopener">Open the reporting dashboard</a></p>
      <p class="muted">The dashboard is for your reporting team and opens in a new tab.</p></div>
    <div class="card"><h2>What this app reads</h2><ul>
      <li>Orders: dates, totals, discounts, payment and fulfillment status, and products ordered.</li>
      <li>Customers: names, email addresses and phone numbers shown on orders, to group repeat customers.</li>
      <li>Products and inventory: product titles, listings, stock levels, locations, sales channels and markets.</li>
      <li>Sales and visitor figures from Shopify's own analytics, reports and marketing events.</li>
      <li>Discounts, gift cards, shipping settings and Shopify Payments payouts, to explain order totals.</li></ul>
      <p class="muted">The app only reads. It never creates, edits or deletes anything in your store.</p></div>
    <div class="card"><h2>Disconnect</h2>
      <p>Uninstall the app any time from <strong>Settings &rsaquo; Apps and sales channels</strong> in your Shopify admin. Syncing stops immediately and your data is erased within 48 hours.</p>
      <p><a href="${esc(siteUrl)}/privacy" target="_blank" rel="noopener">Privacy policy</a> &middot;
         <a href="${esc(siteUrl)}/terms" target="_blank" rel="noopener">Terms</a> &middot;
         <a href="${esc(siteUrl)}/support" target="_blank" rel="noopener">Support</a></p></div>`,
    apiKey
  );
}
