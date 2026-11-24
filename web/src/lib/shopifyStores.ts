import { getAdminClient } from "@/lib/supabase/admin";

// The client row for a Shopify store, created on the spot when a store installs the public app by
// itself (an App Store merchant, or Shopify's own review). The new client is "pending approval":
// sync is off and nothing is fetched until an admin approves it.
export async function ensureClientForShop(shop: string): Promise<{ clientId: string; created: boolean } | null> {
  const admin = getAdminClient();
  const existing = await admin.from("clients").select("client_id").ilike("shopify_store_domain", shop).maybeSingle();
  if (existing.data) return { clientId: existing.data.client_id as string, created: false };

  const base = shop.replace(/\.myshopify\.com$/i, "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40) || "store";
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { error } = await admin.from("clients").insert({
      client_id: id,
      display_name: base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      shopify_store_domain: shop,
      pending_approval: true,
    });
    if (!error) return { clientId: id, created: true };
    if (error.code !== "23505") break; // anything other than "that id is taken"
  }
  return null;
}
