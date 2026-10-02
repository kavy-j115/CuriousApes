import { SHOP_DOMAIN_PATTERN } from "./shopifyOAuth";

// Blank means "not connected". Store domain is normalized (users paste
// https://, trailing slashes, mixed case); the Meta account ID is stored as
// bare digits because the connector adds the `act_` prefix itself.
export function normalizeConnections(input: {
  shopifyStoreDomain: string | null;
  metaAdAccountId: string | null;
  ga4PropertyId: string | null;
}) {
  const domain = (input.shopifyStoreDomain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  if (domain && !SHOP_DOMAIN_PATTERN.test(domain)) {
    throw new Error("Store domain must look like brandname.myshopify.com.");
  }
  const meta = (input.metaAdAccountId ?? "").trim().replace(/^act_/i, "");
  if (meta && !/^\d+$/.test(meta)) throw new Error("Meta ad account ID must be digits only.");
  const ga4 = (input.ga4PropertyId ?? "").trim();
  if (ga4 && !/^\d+$/.test(ga4)) throw new Error("GA4 property ID must be digits only.");
  return {
    shopify_store_domain: domain || null,
    meta_ad_account_id: meta || null,
    ga4_property_id: ga4 || null,
  };
}
