import { createHmac, timingSafeEqual } from "crypto";
import { SHOP_DOMAIN_PATTERN } from "@/lib/shopifyOAuth";

// Verifies the session token (a JWT signed with the app's client secret) that Shopify passes when it
// opens an embedded app: signature, audience (our client id), validity window, and the shop it is for.
export function verifySessionToken(token: string, secret: string, apiKey: string): { shop: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aud?: string; dest?: string; exp?: number; nbf?: number };
    const now = Math.floor(Date.now() / 1000);
    if (claims.aud !== apiKey) return null;
    if (typeof claims.exp !== "number" || claims.exp + 10 < now) return null;
    if (typeof claims.nbf === "number" && claims.nbf - 10 > now) return null;
    const shop = new URL(claims.dest ?? "").hostname.toLowerCase();
    return SHOP_DOMAIN_PATTERN.test(shop) ? { shop } : null;
  } catch {
    return null;
  }
}
