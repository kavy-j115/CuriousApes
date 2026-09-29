export type ReportRow = {
  client_id: string;
  report_date: string;
  sessions: number | null;
  add_to_carts: number | null;
  checkouts: number | null;
  order_count: number;
  gross_revenue: string;
  aov: string;
  amount_spent: string | null;
  purchase_value: string | null;
  proas: string | null;
  atc_pct: string | null;
  conversion_pct: string | null;
  checkout_pct: string | null;
  mtd_sale: string;
  lmtd_sale: string | null;
};

export function fmtNum(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtPct(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

export const REPORT_COLUMNS: { label: string; key: keyof ReportRow; fmt: (r: ReportRow) => string }[] = [
  { label: "Day", key: "report_date", fmt: (r) => r.report_date },
  { label: "Sessions", key: "sessions", fmt: (r) => fmtNum(r.sessions) },
  { label: "Cart Adds", key: "add_to_carts", fmt: (r) => fmtNum(r.add_to_carts) },
  { label: "Orders", key: "order_count", fmt: (r) => fmtNum(r.order_count) },
  { label: "Gross Sales", key: "gross_revenue", fmt: (r) => fmtNum(r.gross_revenue) },
  { label: "AOV", key: "aov", fmt: (r) => fmtNum(r.aov) },
  { label: "Ad Spend", key: "amount_spent", fmt: (r) => fmtNum(r.amount_spent) },
  { label: "Purchase Value", key: "purchase_value", fmt: (r) => fmtNum(r.purchase_value) },
  { label: "PROAS", key: "proas", fmt: (r) => fmtNum(r.proas) },
  { label: "ATC %", key: "atc_pct", fmt: (r) => fmtPct(r.atc_pct) },
  { label: "Conv %", key: "conversion_pct", fmt: (r) => fmtPct(r.conversion_pct) },
  { label: "Checkout %", key: "checkout_pct", fmt: (r) => fmtPct(r.checkout_pct) },
  { label: "MTD Sale", key: "mtd_sale", fmt: (r) => fmtNum(r.mtd_sale) },
  { label: "LMTD", key: "lmtd_sale", fmt: (r) => fmtNum(r.lmtd_sale) },
];

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
  const amountSpent = sum((r) => r.amount_spent);
  const purchaseValue = sum((r) => r.purchase_value);

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
    aov: String(ratio(grossRevenue, orderCount) ?? 0),
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
  };
}
