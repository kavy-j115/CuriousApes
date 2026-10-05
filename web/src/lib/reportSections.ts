// Pure helpers behind the extra report formats on the Reports page (orders summary,
// product share, landing pages, monthly health, RTO). No database access here: the
// pages pass in daily rows and these functions add them up.

export type DailyOrderStats = {
  order_date: string;
  orders: number;
  repeat_orders: number;
  single_item_orders: number;
  multi_item_orders: number;
  orders_up_to_5000: number;
  orders_over_5000: number;
  paid_orders: number;
  total_sum: number | string;
  rto_orders: number;
  cancellation_orders: number;
};

export type DailyProductSales = { order_date: string; product_title: string; gross_sales: number | string };
export type LandingRow = { month: string; landing_page_path: string; sessions: number; sessions_with_cart_additions: number };
export type DailyMetricRow = { report_date: string; sessions: number | null; add_to_carts: number | null; order_count: number | null; gross_revenue: number | string | null };

const num = (v: unknown) => Number(v ?? 0) || 0;
export const pct = (a: number, b: number) => (b > 0 ? a / b : null);

export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Monday of the week an ISO date falls in.
export function weekStart(iso: string): string {
  const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return shiftIso(iso, -dow);
}

const SHORT = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export type Week = { start: string; end: string; label: string; partial: boolean };

// The last `count` weeks (Monday to Sunday), newest first, the newest ending no later
// than `lastDay` (the last COMPLETE day) -- so a half-finished day is never in a week.
export function lastWeeks(lastDay: string, count: number): Week[] {
  const out: Week[] = [];
  let start = weekStart(lastDay);
  for (let i = 0; i < count; i++) {
    const fullEnd = shiftIso(start, 6);
    const end = fullEnd > lastDay ? lastDay : fullEnd;
    out.push({ start, end, label: `${SHORT(start)} – ${SHORT(end)}`, partial: end !== fullEnd });
    start = shiftIso(start, -7);
  }
  return out;
}

export function lastMonths(lastDay: string, count: number): { month: string; label: string }[] {
  const out: { month: string; label: string }[] = [];
  let m = `${lastDay.slice(0, 8)}01`;
  for (let i = 0; i < count; i++) {
    out.push({
      month: m,
      label: new Date(`${m}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
    });
    m = shiftIso(m, -1).slice(0, 8) + "01";
  }
  return out;
}

function inWeek(date: string, w: Week) {
  return date >= w.start && date <= w.end;
}

export type OrdersWeek = {
  week: Week;
  orders: number;
  repeat: number;
  fresh: number;
  single: number;
  multi: number;
  upTo5000: number;
  over5000: number;
  paid: number;
  others: number;
  aov: number | null;
};

export function ordersByWeek(rows: DailyOrderStats[], weeks: Week[]): OrdersWeek[] {
  return weeks.map((week) => {
    const r = rows.filter((x) => inWeek(x.order_date, week));
    const sum = (f: (x: DailyOrderStats) => number) => r.reduce((a, x) => a + f(x), 0);
    const orders = sum((x) => num(x.orders));
    const repeat = sum((x) => num(x.repeat_orders));
    const paid = sum((x) => num(x.paid_orders));
    const total = sum((x) => num(x.total_sum));
    return {
      week,
      orders,
      repeat,
      fresh: orders - repeat,
      single: sum((x) => num(x.single_item_orders)),
      multi: sum((x) => num(x.multi_item_orders)),
      upTo5000: sum((x) => num(x.orders_up_to_5000)),
      over5000: sum((x) => num(x.orders_over_5000)),
      paid,
      others: orders - paid,
      aov: orders > 0 ? total / orders : null,
    };
  });
}

export type ProductShareTable = {
  weeks: Week[];
  rows: { title: string; shares: (number | null)[]; total: number | null }[];
};

// Share of each week's gross sales per product (every week column adds up to 100%),
// the top `limit` products by sales across the whole window.
export function productShare(rows: DailyProductSales[], weeks: Week[], limit = 25): ProductShareTable {
  const weekTotals = weeks.map(() => 0);
  const byProduct = new Map<string, number[]>();
  for (const r of rows) {
    const idx = weeks.findIndex((w) => inWeek(r.order_date, w));
    if (idx < 0) continue;
    const v = num(r.gross_sales);
    weekTotals[idx] += v;
    const arr = byProduct.get(r.product_title) ?? weeks.map(() => 0);
    arr[idx] += v;
    byProduct.set(r.product_title, arr);
  }
  const grand = weekTotals.reduce((a, b) => a + b, 0);
  const list = [...byProduct.entries()]
    .map(([title, arr]) => ({ title, arr, sum: arr.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.sum - a.sum)
    .slice(0, limit)
    .map((p) => ({
      title: p.title,
      shares: p.arr.map((v, i) => pct(v, weekTotals[i])),
      total: pct(p.sum, grand),
    }));
  return { weeks, rows: list };
}

export type LandingTable = {
  months: { month: string; label: string }[];
  rows: { path: string; cells: { share: number | null; atc: number | null }[]; totalShare: number | null; totalAtc: number | null }[];
};

export function landingPages(rows: LandingRow[], months: { month: string; label: string }[], limit = 25): LandingTable {
  const monthTotals = months.map(() => 0);
  const byPath = new Map<string, { sessions: number; atc: number }[]>();
  for (const r of rows) {
    const idx = months.findIndex((m) => m.month === r.month.slice(0, 10));
    if (idx < 0) continue;
    monthTotals[idx] += num(r.sessions);
    const arr = byPath.get(r.landing_page_path) ?? months.map(() => ({ sessions: 0, atc: 0 }));
    arr[idx].sessions += num(r.sessions);
    arr[idx].atc += num(r.sessions_with_cart_additions);
    byPath.set(r.landing_page_path, arr);
  }
  const grand = monthTotals.reduce((a, b) => a + b, 0);
  const list = [...byPath.entries()]
    .map(([path, arr]) => ({ path, arr, s: arr.reduce((a, c) => a + c.sessions, 0), a: arr.reduce((a, c) => a + c.atc, 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((p) => ({
      path: p.path,
      cells: p.arr.map((c, i) => ({ share: pct(c.sessions, monthTotals[i]), atc: pct(c.atc, c.sessions) })),
      totalShare: pct(p.s, grand),
      totalAtc: pct(p.a, p.s),
    }));
  return { months, rows: list };
}

export type MonthlyRow = {
  label: string;
  sessions: number;
  cartSessions: number;
  orders: number;
  gross: number;
  atcPct: number | null;
  convPct: number | null;
  checkoutPct: number | null;
};

function monthly(sessions: number, cartSessions: number, orders: number, gross: number, label: string): MonthlyRow {
  return {
    label,
    sessions,
    cartSessions,
    orders,
    gross,
    atcPct: pct(cartSessions, sessions),
    convPct: pct(orders, sessions),
    // Of the people who added to cart, how many ordered (the agency's "Checkout %").
    checkoutPct: pct(orders, cartSessions),
  };
}

export function monthlyHealth(rows: DailyMetricRow[], months: { month: string; label: string }[]): { rows: MonthlyRow[]; total: MonthlyRow } {
  const out = months.map((m) => {
    const next = shiftIso(m.month, 31).slice(0, 8) + "01";
    const r = rows.filter((x) => x.report_date >= m.month && x.report_date < next);
    return monthly(
      r.reduce((a, x) => a + num(x.sessions), 0),
      r.reduce((a, x) => a + num(x.add_to_carts), 0),
      r.reduce((a, x) => a + num(x.order_count), 0),
      r.reduce((a, x) => a + num(x.gross_revenue), 0),
      m.label
    );
  });
  const t = out.reduce(
    (a, x) => ({ s: a.s + x.sessions, c: a.c + x.cartSessions, o: a.o + x.orders, g: a.g + x.gross }),
    { s: 0, c: 0, o: 0, g: 0 }
  );
  return { rows: out, total: monthly(t.s, t.c, t.o, t.g, "Total") };
}

export type RtoDay = { date: string; orders: number; rto: number; cancel: number; rtoPct: number | null; cancelPct: number | null };

export function rtoTable(rows: DailyOrderStats[]): { days: RtoDay[]; total: RtoDay } {
  const days = [...rows]
    .sort((a, b) => a.order_date.localeCompare(b.order_date))
    .map((r) => ({
      date: r.order_date,
      orders: num(r.orders),
      rto: num(r.rto_orders),
      cancel: num(r.cancellation_orders),
      rtoPct: pct(num(r.rto_orders), num(r.orders)),
      cancelPct: pct(num(r.cancellation_orders), num(r.orders)),
    }));
  const o = days.reduce((a, d) => a + d.orders, 0);
  const r = days.reduce((a, d) => a + d.rto, 0);
  const c = days.reduce((a, d) => a + d.cancel, 0);
  return { days, total: { date: "Grand Total", orders: o, rto: r, cancel: c, rtoPct: pct(r, o), cancelPct: pct(c, o) } };
}

// Green (low) through yellow to red (high) across a column, as in the RTO table.
export function scaleColor(value: number | null, min: number, max: number): string | undefined {
  if (value === null || max <= min) return undefined;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const hue = 130 - 130 * t; // 130 = green, 0 = red
  return `hsl(${hue} 55% 38% / 0.55)`;
}
