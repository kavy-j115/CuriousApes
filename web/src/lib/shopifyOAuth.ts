import { createHmac, timingSafeEqual } from "crypto";

// Pure helpers for the Shopify authorization-code install flow -- no
// network, no database, so they can be tested directly. The callback route
// (api/shopify/callback) and the admin "install link" action wire them up.

export const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

// The install link is sent to the client's store owner, who is NOT logged
// into this app -- so the callback can't rely on a session or cookie to know
// which client it's for. The state parameter carries the client_id and an
// expiry, signed with the app's client secret, so it can't be forged or
// reused for a different client.
const STATE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length > 0 && ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function signState(clientId: string, secret: string, now = Date.now()): string {
  const payload = `${clientId}~${now + STATE_TTL_MS}`;
  return `${payload}~${sign(secret, payload)}`;
}

export function verifyState(state: string, secret: string, now = Date.now()): { clientId: string } | null {
  const parts = state.split("~");
  if (parts.length !== 3) return null;
  const [clientId, expiry, signature] = parts;
  if (!clientId || !/^\d+$/.test(expiry)) return null;
  if (!safeEqualHex(signature, sign(secret, `${clientId}~${expiry}`))) return null;
  if (Number(expiry) < now) return null;
  return { clientId };
}

// Shopify signs every callback: HMAC-SHA256 (hex) of the sorted query
// string with the `hmac` parameter removed, keyed by the app's client secret.
export function verifyShopifyHmac(params: URLSearchParams, secret: string): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return safeEqualHex(provided, sign(secret, message));
}

export function buildInstallUrl(args: {
  shop: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  if (!SHOP_DOMAIN_PATTERN.test(args.shop)) throw new Error("Invalid Shopify store domain.");
  const query = new URLSearchParams({
    client_id: args.clientId,
    scope: args.scopes,
    redirect_uri: args.redirectUri,
    state: args.state,
  });
  return `https://${args.shop}/admin/oauth/authorize?${query.toString()}`;
}
