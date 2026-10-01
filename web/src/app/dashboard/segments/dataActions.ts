"use server";

import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_FIELDS, type CustomerCondition } from "@/lib/segmentFields";

// Powers Segments' "Select from our data" path -- builds a segment
// directly from what's already synced into Postgres instead of requiring
// a fresh Shopify CSV export every time. Two separate queries (customer_ltv,
// then customers) rather than one joined query, since customer_ltv is a
// view with no declared foreign key PostgREST can embed on -- merged here
// in application code instead.

export type CustomerCandidate = {
  customer_id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  order_count: number;
  lifetime_value: number;
  first_order_date: string;
  last_order_date: string;
};

async function attachContactInfo(clientId: string, ltvRows: { customer_id: string; order_count: number; lifetime_value: number; first_order_date: string; last_order_date: string }[]): Promise<CustomerCandidate[]> {
  if (ltvRows.length === 0) return [];
  const supabase = await createClient();
  const ids = ltvRows.map((r) => r.customer_id);
  const { data: contactRows } = await supabase
    .from("customers")
    .select("shopify_customer_id, email, phone, first_name, last_name")
    .eq("client_id", clientId)
    .in("shopify_customer_id", ids);

  const contactById = new Map((contactRows ?? []).map((c) => [c.shopify_customer_id as string, c]));
  return ltvRows.map((r) => {
    const c = contactById.get(r.customer_id);
    return {
      customer_id: r.customer_id,
      email: (c?.email as string) ?? null,
      phone: (c?.phone as string) ?? null,
      first_name: (c?.first_name as string) ?? null,
      last_name: (c?.last_name as string) ?? null,
      order_count: r.order_count,
      lifetime_value: Number(r.lifetime_value),
      first_order_date: r.first_order_date,
      last_order_date: r.last_order_date,
    };
  });
}

// Fully user-defined filtering -- any number of conditions on any of
// CUSTOMER_FIELDS, ANDed together. Replaces an earlier version with three
// fixed filters (min orders / min lifetime value / inactive window): real
// clients wanted other combinations this couldn't express.
export async function searchCustomers(clientId: string, conditions: CustomerCondition[]): Promise<CustomerCandidate[]> {
  const supabase = await createClient();
  let query = supabase
    .from("customer_ltv")
    .select("customer_id, order_count, lifetime_value, first_order_date, last_order_date")
    .eq("client_id", clientId);

  for (const c of conditions) {
    if (c.value === "") continue;
    const value = CUSTOMER_FIELDS.find((f) => f.key === c.field)?.type === "number" ? Number(c.value) : c.value;
    if (c.operator === "gte") query = query.gte(c.field, value);
    else if (c.operator === "lte") query = query.lte(c.field, value);
    else if (c.operator === "eq") query = query.eq(c.field, value);
  }

  const { data } = await query.limit(500);
  return attachContactInfo(clientId, data ?? []);
}

export type ProductCandidate = {
  title: string;
  sku: string | null;
  units_sold: number;
  revenue: number;
  distinct_customers: number;
};

export async function searchProducts(clientId: string): Promise<ProductCandidate[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product_performance")
    .select("title, sku, units_sold, revenue, distinct_customers")
    .eq("client_id", clientId)
    .order("revenue", { ascending: false })
    .limit(200);

  return (data ?? []).map((r) => ({
    title: r.title as string,
    sku: r.sku as string | null,
    units_sold: r.units_sold as number,
    revenue: Number(r.revenue),
    distinct_customers: r.distinct_customers as number,
  }));
}

export async function customersByProducts(clientId: string, titles: string[]): Promise<CustomerCandidate[]> {
  if (titles.length === 0) return [];
  const supabase = await createClient();

  const { data: lineItemRows } = await supabase
    .from("order_line_items")
    .select("orders!inner(client_id, customer_id)")
    .in("title", titles)
    .eq("orders.client_id", clientId);

  const customerIds = Array.from(
    new Set(
      (lineItemRows ?? [])
        .map((r) => (r as unknown as { orders: { customer_id: string | null } }).orders?.customer_id)
        .filter((id): id is string => !!id)
    )
  );
  if (customerIds.length === 0) return [];

  const { data: ltvRows } = await supabase
    .from("customer_ltv")
    .select("customer_id, order_count, lifetime_value, first_order_date, last_order_date")
    .eq("client_id", clientId)
    .in("customer_id", customerIds);

  return attachContactInfo(clientId, ltvRows ?? []);
}
