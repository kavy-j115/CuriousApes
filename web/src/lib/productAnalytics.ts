import type { OrderExportRow } from "./segmentRecipes";

export type ProductStats = {
  title: string;
  unitsSold: number;
  orderCount: number;
  revenue: number;
};

// Needs an Orders export specifically, not a plain Shopify "Products"
// export -- Shopify's product catalog export has no sales data at all
// (no units sold, no revenue, no order count). That data only exists on
// the order line items themselves, so this reads straight off the same
// Orders export the other recipes use, aggregated by "Lineitem name"
// instead of filtered down to a segment.
export function aggregateProductStats(rows: OrderExportRow[]): ProductStats[] {
  const byProduct = new Map<string, { unitsSold: number; revenue: number; orderNames: Set<string> }>();

  for (const row of rows) {
    const title = row["Lineitem name"];
    if (!title) continue;
    const entry = byProduct.get(title) ?? { unitsSold: 0, revenue: 0, orderNames: new Set<string>() };
    const quantity = Number(row["Lineitem quantity"] || 0);
    const price = Number(row["Lineitem price"] || 0);
    entry.unitsSold += quantity;
    entry.revenue += quantity * price;
    if (row["Name"]) entry.orderNames.add(row["Name"]);
    byProduct.set(title, entry);
  }

  return Array.from(byProduct.entries()).map(([title, v]) => ({
    title,
    unitsSold: v.unitsSold,
    orderCount: v.orderNames.size,
    revenue: v.revenue,
  }));
}
