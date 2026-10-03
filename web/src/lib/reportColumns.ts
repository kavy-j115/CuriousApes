import type { CSSProperties } from "react";
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
  | "lmtd_sale"
  | "mtd_total_sales"
  | "lmtd_total_sales";

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
  // Same running totals on Total sales, for clients whose report headlines Total sales.
  { key: "mtd_total_sales", defaultLabel: "MTD Sale" },
  { key: "lmtd_total_sales", defaultLabel: "LMTD Total Sale" },
];

// What every client gets unless report_config overrides it -- same set/
// order this app always used, with net_revenue left out (opt-in per
// client, not everyone wants both revenue numbers on the same report).
export const DEFAULT_METRIC_KEYS: MetricKey[] = [
  "sessions",
  "add_to_carts",
  "order_count",
  "gross_revenue",
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
  // Place this column right after that metric (Zari's "Organic Sales" sits next to
  // Total sales); omitted = at the end.
  after?: MetricKey;
};

export type ReportConfig = {
  columns: { key: MetricKey; label: string }[];
  derivedColumns?: DerivedColumn[];
  // Each brand's report has its own header colour (hex, e.g. "4472C4").
  headerColor?: string;
} | null;

export const ALL_METRIC_KEYS: MetricKey[] = [
  "sessions", "add_to_carts", "order_count", "gross_revenue", "net_revenue",
  "aov", "amount_spent", "purchase_value", "proas", "atc_pct",
  "conversion_pct", "checkout_pct", "mtd_sale", "lmtd_sale",
  "total_sales", "total_discounts", "total_refunded", "mtd_total_sales", "lmtd_total_sales",
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
  cellStyle?: (r: ReportRow) => CSSProperties | undefined;
};

function metricFmt(key: MetricKey): (r: ReportRow) => string {
  return PCT_KEYS.has(key) ? (r) => fmtPct(r[key]) : (r) => fmtNum(r[key]);
}

export function defaultLabel(key: MetricKey): string {
  return AVAILABLE_METRICS.find((m) => m.key === key)?.defaultLabel ?? key;
}

// PROAS colouring: a continuous red -> yellow -> green scale based on the
// values in the table itself (lowest = red, median = yellow, highest = green),
// like the agency's Excel reports -- never fixed good/bad thresholds. Pass every
// row that is shown, including a Total row, so colours are relative to them.
const SCALE_RED = [248, 105, 107];
const SCALE_YELLOW = [255, 235, 132];
const SCALE_GREEN = [99, 190, 123];

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

export function proasColorScale(rows: ReportRow[]): (r: ReportRow) => CSSProperties | undefined {
  const values = rows
    .map((r) => r.proas)
    .filter((v) => v !== null && v !== undefined)
    .map(Number)
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
  if (values.length < 2 || values[0] === values[values.length - 1]) return () => undefined;

  const min = values[0];
  const max = values[values.length - 1];
  const half = values.length / 2;
  const median = values.length % 2 ? values[(values.length - 1) / 2] : (values[half - 1] + values[half]) / 2;

  return (r) => {
    if (r.proas === null || r.proas === undefined) return undefined;
    const v = Number(r.proas);
    if (Number.isNaN(v)) return undefined;
    const rgb =
      v <= median
        ? mix(SCALE_RED, SCALE_YELLOW, median === min ? 1 : (v - min) / (median - min))
        : mix(SCALE_YELLOW, SCALE_GREEN, max === median ? 1 : (v - median) / (max - median));
    return { backgroundColor: `rgba(${rgb.join(",")},0.5)` };
  };
}

// `report_date` ("Day") is always first and never configurable -- every
// report needs a consistent first column to anchor on. `scaleRows` are the
// rows (and Total row) the PROAS colour scale is computed over.
export function resolveReportColumns(config: ReportConfig, scaleRows: ReportRow[] = []): ColumnDef[] {
  const dayColumn: ColumnDef = { key: "report_date", label: "Day", fmt: (r) => r.report_date };
  const proasStyle = proasColorScale(scaleRows);

  function toColumnDef(key: MetricKey, label: string): ColumnDef {
    return {
      key,
      label,
      fmt: metricFmt(key),
      cellStyle: key === "proas" ? proasStyle : undefined,
    };
  }

  const columns: ColumnDef[] =
    config && config.columns.length > 0
      ? config.columns.map((c) => toColumnDef(c.key, c.label))
      : DEFAULT_METRIC_KEYS.map((key) => toColumnDef(key, defaultLabel(key)));

  // Derived columns: their values must already be attached to each row via
  // attachDerivedColumns() before these fmt functions run (the row type
  // doesn't know about them statically). Placed after their `after` column
  // when given, otherwise at the end.
  for (const dc of config?.derivedColumns ?? []) {
    const col: ColumnDef = {
      key: dc.key,
      label: dc.label,
      fmt: (r: ReportRow) => {
        const v = (r as unknown as Record<string, string | null>)[dc.key] ?? null;
        return dc.isPct ? fmtPct(v) : fmtNum(v);
      },
    };
    const at = dc.after ? columns.findIndex((c) => c.key === dc.after) : -1;
    if (at >= 0) columns.splice(at + 1, 0, col);
    else columns.push(col);
  }

  return [dayColumn, ...columns];
}
