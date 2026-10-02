export type ReportRow = {
  client_id: string;
  report_date: string;
  sessions: number | null;
  add_to_carts: number | null;
  checkouts: number | null;
  order_count: number;
  gross_revenue: string;
  net_revenue: string;
  aov: string;
  amount_spent: string | null;
  purchase_value: string | null;
  proas: string | null;
  atc_pct: string | null;
  conversion_pct: string | null;
  checkout_pct: string | null;
  mtd_sale: string;
  lmtd_sale: string | null;
  total_discounts: string | null;
  total_refunded: string | null;
  total_sales: string | null;
};

export function fmtNum(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtPct(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

// Mirrors the Excel report's Total row: SUM for absolute counts/amounts,
// a true weighted ratio (not an average-of-daily-ratios) for AOV/PROAS/%s.
export function computeTotal(rows: ReportRow[]): ReportRow {
  // null (not 0) when every contributing row was null -- "no data connected"
  // and "connected, genuinely zero" are different claims, same rule as the
  // Excel report (see docs/reporting.md).
  const sum = (f: (r: ReportRow) => number | string | null): number | null => {
    const values = rows.map(f).filter((v) => v !== null && v !== undefined);
    if (values.length === 0) return null;
    return values.reduce((acc: number, v) => acc + Number(v), 0);
  };

  const sessions = sum((r) => r.sessions);
  const addToCarts = sum((r) => r.add_to_carts);
  const checkouts = sum((r) => r.checkouts);
  const orderCount = sum((r) => r.order_count) ?? 0;
  const grossRevenue = sum((r) => r.gross_revenue) ?? 0;
  const netRevenue = sum((r) => r.net_revenue);
  const amountSpent = sum((r) => r.amount_spent);
  const purchaseValue = sum((r) => r.purchase_value);
  const totalDiscounts = sum((r) => r.total_discounts);
  const totalRefunded = sum((r) => r.total_refunded);
  const totalSales = sum((r) => r.total_sales);

  const ratio = (numerator: number | null, denominator: number | null) =>
    numerator !== null && denominator ? numerator / denominator : null;

  return {
    client_id: rows[0]?.client_id ?? "",
    report_date: "Total",
    sessions,
    add_to_carts: addToCarts,
    checkouts,
    order_count: orderCount,
    gross_revenue: String(grossRevenue),
    net_revenue: netRevenue === null ? "0" : String(netRevenue),
    aov: String(ratio(totalSales, orderCount) ?? 0),
    amount_spent: amountSpent === null ? null : String(amountSpent),
    purchase_value: purchaseValue === null ? null : String(purchaseValue),
    proas: ratio(purchaseValue, amountSpent) as unknown as string,
    atc_pct: ratio(addToCarts, sessions) as unknown as string,
    conversion_pct: ratio(orderCount, sessions) as unknown as string,
    checkout_pct: ratio(checkouts, sessions) as unknown as string,
    // MTD/LMTD are already-cumulative figures, not additive across days --
    // the most recent row's value is the meaningful one for a range total.
    mtd_sale: rows[0]?.mtd_sale ?? "0",
    lmtd_sale: rows[0]?.lmtd_sale ?? null,
    total_discounts: totalDiscounts === null ? null : String(totalDiscounts),
    total_refunded: totalRefunded === null ? null : String(totalRefunded),
    total_sales: totalSales === null ? null : String(totalSales),
  };
}
