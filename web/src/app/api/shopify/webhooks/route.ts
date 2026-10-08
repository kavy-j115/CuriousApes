import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { deleteClientEverything } from "@/lib/clientDeletion";
import { verifyWebhookHmac } from "@/lib/shopifyOAuth";
import { getShopifyClientSecret } from "@/lib/shopifyConfig";

// Shopify's webhooks for a public app. Reachable without a login (proxy.ts exempts it): trust
// comes only from Shopify's HMAC signature over the raw body. Topics:
//   customers/data_request  a customer asked for their data   -> logged in privacy_requests (answered by hand)
//   customers/redact        erase one customer's personal data -> redact_shopify_customer()
//   shop/redact             erase a store (48 h after uninstall) -> deleteClientEverything()
//   app/uninstalled         the merchant removed the app       -> the client is paused (sync off, data kept)
// These are subscribed in the app's configuration in the Shopify Dev Dashboard, not through the
// API, so nothing here ever writes to Shopify. Shopify retries on any non-2xx answer.

type Json = Record<string, unknown>;

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let secret: string;
  try {
    secret = await getShopifyClientSecret();
  } catch {
    return new NextResponse("Not configured", { status: 500 });
  }
  if (!verifyWebhookHmac(raw, request.headers.get("x-shopify-hmac-sha256"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shop = (request.headers.get("x-shopify-shop-domain") ?? "").toLowerCase();
  let payload: Json = {};
  try {
    payload = raw ? (JSON.parse(raw) as Json) : {};
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const admin = getAdminClient();
  const { data: client } = await admin.from("clients").select("client_id").ilike("shopify_store_domain", shop).maybeSingle();
  const clientId = (client?.client_id as string | undefined) ?? null;
  const log = async (kind: string, handled: boolean, note?: string) => {
    await admin.from("privacy_requests").insert({
      kind,
      shop_domain: shop,
      client_id: clientId,
      payload,
      handled_at: handled ? new Date().toISOString() : null,
      note: note ?? null,
    });
  };

  try {
    switch (topic) {
      case "customers/data_request":
        await log("customers_data_request", false, "Answer the merchant: send the data held for this customer.");
        break;
      case "customers/redact": {
        const customerId = String((payload.customer as Json | undefined)?.id ?? "");
        let note = "No matching store or customer.";
        if (customerId) {
          const { data } = await admin.rpc("redact_shopify_customer", { p_shop_domain: shop, p_shopify_customer_id: customerId });
          const row = Array.isArray(data) ? data[0] : data;
          note = `Redacted ${row?.customers_redacted ?? 0} customer row(s) and ${row?.raw_orders_redacted ?? 0} stored order(s).`;
        }
        await log("customers_redact", true, note);
        break;
      }
      case "shop/redact": {
        if (clientId) await deleteClientEverything(clientId);
        await log("shop_redact", true, clientId ? `Deleted client ${clientId} and all its data.` : "No client for this store.");
        break;
      }
      case "app/uninstalled": {
        if (clientId) {
          await admin
            .from("clients")
            .update({ paused_at: new Date().toISOString(), sync_enabled: false, pause_reason: "shopify_uninstalled" })
            .eq("client_id", clientId);
        }
        await log("app_uninstalled", true, clientId ? `Paused ${clientId}.` : "No client for this store.");
        break;
      }
      default:
        break; // a topic we did not subscribe to: acknowledge and ignore
    }
  } catch (e) {
    console.error("shopify webhook failed", topic, e instanceof Error ? e.message : e);
    return new NextResponse("Failed", { status: 500 }); // Shopify will retry
  }
  return new NextResponse("ok", { status: 200 });
}
