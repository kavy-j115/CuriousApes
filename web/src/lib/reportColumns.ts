import { ReportRow, fmtNum, fmtPct } from "./reportMath";
import { evaluateFormula } from "./formulaEval";

// The fixed set of metrics a client's report can be built from -- a
// per-client report_config can only choose which of these to show, in
// what order, under what label. It can't invent a new formula; a genuinely
// new calculation is still a real code change (new column in the SQL view
// + here), not something an admin can configure on their own. See
// sql/015_report_config.sql.
export type MetricKey =
  | "sessions"
  | "add_to_carts"
  | "order_count"
  | "gross_revenue"
  | "net_revenue"
  | "total_sales"
  | "total_discounts"
  | "total_refunded"
  | "aov"
  | "amount_spent"
  | "purchase_value"
  | "proas"
  | "atc_pct"
  | "conversion_pct"
  | "checkout_pct"
  | "mtd_sale"
  | "lmtd_sale";

const PCT_KEYS = new Set<MetricKey>(["atc_pct", "conversion_pct", "checkout_pct"]);

export const AVAILABLE_METRICS: { key: MetricKey; defaultLabel: string }[] = [
  { key: "sessions", defaultLabel: "Sessions" },
  { key: "add_to_carts", defaultLabel: "Cart Adds" },
  { key: "order_count", defaultLabel: "Orders" },
  { key: "gross_revenue", defaultLabel: "Gross Sales" },
  { key: "net_revenue", defaultLabel: "Net Sales" },
  { key: "total_sales", defaultLabel: "Total Sales" },
  { key: "total_discounts", defaultLabel: "Discounts" },
  { key: "total_refunded", defaultLabel: "Refunds" },
  { key: "aov", defaultLabel: "AOV" },
  { key: "amount_spent", defaultLabel: "Ad Spend" },
  { key: "purchase_value", defaultLabel: "Purchase Value" },
  { key: "proas", defaultLabel: "PROAS" },
  { key: "atc_pct", defaultLabel: "ATC %" },
  { key: "conversion_pct", defaultLabel: "Conv %" },
  { key: "checkout_pct", defaultLabel: "Checkout %" },
  { key: "mtd_sale", defaultLabel: "MTD Sale" },
  { key: "lmtd_sale", defaultLabel: "LMTD" },
];

// What every client gets unless report_config overrides it -- same set/
// order this app always used, with net_revenue left out (opt-in per
// client, not everyone wants both revenue numbers on the same report).
export const DEFAULT_METRIC_KEYS: MetricKey[] = [
  "sessions",
  "add_to_carts",
  "order_count",
  "gross_revenue",
  "total_sales",
  "aov",
  "amount_spent",
  "purchase_value",
  "proas",
  "atc_pct",
  "conversion_pct",
  "checkout_pct",
  "mtd_sale",
  "lmtd_sale",
];

// PROAS color-coding: green at/above `good`, red below `danger`, orange in
// between -- shows at a glance which days are healthy vs. which need
// attention, the same "don't make someone read every number" idea as the
// alert thresholds (docs/alerts.md), just as a color instead of a
// notification. Not literally "danger/moderate/good" labels in the UI,
// just the color meaning that.
export type RoasThresholds = { good: number; danger: number };
export const DEFAULT_ROAS_THRESHOLDS: RoasThresholds = { good: 3, danger: 1.5 };

// A client-defined extra column, computed from a formula over the metrics
// above (e.g. "purchase_value / amount_spent" for a blended ROAS that
// isn't one of our built-in ones) -- the "structural" per-client
// difference a column picker alone couldn't express. See formulaEval.ts
// for why this is a hand-written safe evaluator, not eval().
export type DerivedColumn = {
  key: string;
  label: string;
  formula: string;
  isPct: boolean;
};

export type ReportConfig = {
  columns: { key: MetricKey; label: string }[];
  roasThresholds?: RoasThresholds;
  derivedColumns?: DerivedColumn[];
} | null;

export const ALL_METRIC_KEYS: MetricKey[] = [
  "sessions", "add_to_carts", "order_count", "gross_revenue", "net_revenue",
  "aov", "amount_spent", "purchase_value", "proas", "atc_pct",
  "conversion_pct", "checkout_pct", "mtd_sale", "lmtd_sale",
];

// Computes every derivedColumns formula for each row and attaches the
// result under that column's key, so resolveReportColumns()'s fmt for a
// derived column can read it the same way it reads a built-in metric.
// Earlier derived columns are available as variables to later ones
// (chaining), in the order given. A formula error (bad syntax, unknown
// field) produces a blank cell for that row, not a crash -- same "a
// report generates something sane, not nothing" rule as the Python side
// (src/reports/business_health_report.py).
export function attachDerivedColumns<T extends ReportRow>(rows: T[], derivedColumns?: DerivedColumn[]): T[] {
  if (!derivedColumns || derivedColumns.length === 0) return rows;
  return rows.map((row) => {
    const vars: Record<string, number | null> = {};
    for (const key of ALL_METRIC_KEYS) {
      const v = (row as unknown as Record<string, string | number | null>)[key];
      vars[key] = v === null || v === undefined ? null : Number(v);
    }
    const extended = { ...row } as Record<string, unknown>;
    for (const dc of derivedColumns) {
      let value: number | null;
      try {
        value = evaluateFormula(dc.formula, vars);
      } catch {
        value = null;
      }
      extended[dc.key] = value === null ? null : String(value);
      vars[dc.key] = value;
    }
    return extended as T;
  });
}

export type ColumnDef = {
  key: string;
  label: string;
  fmt: (r: ReportRow) => string;
  cellClassName?: (r: ReportRow) => string;
};

function metricFmt(key: MetricKey): (r: ReportRow) => string {
  return PCT_KEYS.has(key) ? (r) => fmtPct(r[key]) : (r) => fmtNum(r[key]);
}

export function defaultLabel(key: MetricKey): string {
  return AVAILABLE_METRICS.find((m) => m.key === key)?.defaultLabel ?? key;
}

function roasCellClassName(thresholds: RoasThresholds): (r: ReportRow) => string {
  return (r) => {
    if (r.proas === null || r.proas === undefined) return "";
    const value = Number(r.proas);
    if (Number.isNaN(value)) return "";
    if (value >= thresholds.good) return "bg-emerald-500/15 text-emerald-400";
    if (value < thresholds.danger) return "bg-red-500/15 text-red-400";
    return "bg-amber-500/15 text-amber-400";
  };
}

// `report_date` ("Day") is always first and never configurable -- every
// report needs a consistent first column to anchor on.
export function resolveReportColumns(config: ReportConfig): ColumnDef[] {
  const dayColumn: ColumnDef = { key: "report_date", label: "Day", fmt: (r) => r.report_date };
  const thresholds = config?.roasThresholds ?? DEFAULT_ROAS_THRESHOLDS;

  function toColumnDef(key: MetricKey, label: string): ColumnDef {
    return {
      key,
      label,
      fmt: metricFmt(key),
      cellClassName: key === "proas" ? roasCellClassName(thresholds) : undefined,
    };
  }

  const metricColumns: ColumnDef[] =
    config && config.columns.length > 0
      ? config.columns.map((c) => toColumnDef(c.key, c.label))
      : DEFAULT_METRIC_KEYS.map((key) => toColumnDef(key, defaultLabel(key)));

  // Derived columns always sit after the chosen metrics -- their values
  // must already be attached to each row via attachDerivedColumns() before
  // these fmt functions run (the row type doesn't know about them statically).
  const derivedCols: ColumnDef[] = (config?.derivedColumns ?? []).map((dc) => ({
    key: dc.key,
    label: dc.label,
    fmt: (r: ReportRow) => {
      const v = (r as unknown as Record<string, string | null>)[dc.key] ?? null;
      return dc.isPct ? fmtPct(v) : fmtNum(v);
    },
  }));

  return [dayColumn, ...metricColumns, ...derivedCols];
}
