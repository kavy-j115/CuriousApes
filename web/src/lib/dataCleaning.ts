import Papa from "papaparse";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export type Row = Record<string, string>;

export type DetectedColumns = {
  headers: string[];
  emailColumns: string[];
  phoneColumns: string[];
  keyLikeColumns: string[]; // reasonable candidates for "dedupe by this column"
  isOrdersExport: boolean; // Shopify Orders export shape: Total + Lineitem price/quantity, one row per line item
  orderGroupColumn: string | null; // "Name" (order number) or "Id" -- repeats per line item
};

const EMAIL_RE = /email/i;
const PHONE_RE = /phone/i;
const KEY_RE = /email|phone|\bid\b|name/i;

export function parseCsv(csvText: string): { headers: string[]; rows: Row[] } {
  const result = Papa.parse<Row>(csvText, { header: true, skipEmptyLines: true });
  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

export function detectColumns(headers: string[]): DetectedColumns {
  const emailColumns = headers.filter((h) => EMAIL_RE.test(h));
  const phoneColumns = headers.filter((h) => PHONE_RE.test(h));
  const keyLikeColumns = headers.filter((h) => KEY_RE.test(h));

  const hasTotal = headers.includes("Total");
  const hasLineitemPrice = headers.includes("Lineitem price");
  const hasLineitemQty = headers.includes("Lineitem quantity");
  const orderGroupColumn = headers.includes("Name") ? "Name" : headers.includes("Id") ? "Id" : null;
  const isOrdersExport = hasTotal && hasLineitemPrice && hasLineitemQty && !!orderGroupColumn;

  return { headers, emailColumns, phoneColumns, keyLikeColumns, isOrdersExport, orderGroupColumn };
}

export type CleaningParams = {
  trimWhitespace: boolean;
  dedupeExact: boolean;
  dedupeByColumn: string | null;
  requiredColumns: string[];
  emailColumn: string | null;
  dropInvalidEmail: boolean;
  phoneColumn: string | null;
  dropInvalidPhone: boolean;
  checkOrderTotals: boolean;
  excludeMismatchedOrders: boolean;
};

export function defaultParams(detected: DetectedColumns): CleaningParams {
  return {
    trimWhitespace: true,
    dedupeExact: true,
    dedupeByColumn: null,
    requiredColumns: [],
    emailColumn: detected.emailColumns[0] ?? null,
    dropInvalidEmail: false,
    phoneColumn: detected.phoneColumns[0] ?? null,
    dropInvalidPhone: false,
    checkOrderTotals: detected.isOrdersExport,
    excludeMismatchedOrders: false,
  };
}

export type CleaningSummary = {
  totalRows: number;
  outputRows: number;
  removedDuplicateExact: number;
  removedDuplicateByColumn: number;
  removedMissingRequired: number;
  removedInvalidEmail: number;
  removedInvalidPhone: number;
  orderTotalMismatches: number;
  removedMismatchedOrders: number;
};

const EMAIL_VALID_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORDER_TOTAL_TOLERANCE = 1.0;

export function cleanRows(
  rows: Row[],
  headers: string[],
  params: CleaningParams
): { rows: Row[]; summary: CleaningSummary } {
  const summary: CleaningSummary = {
    totalRows: rows.length,
    outputRows: 0,
    removedDuplicateExact: 0,
    removedDuplicateByColumn: 0,
    removedMissingRequired: 0,
    removedInvalidEmail: 0,
    removedInvalidPhone: 0,
    orderTotalMismatches: 0,
    removedMismatchedOrders: 0,
  };

  let working: Row[] = rows.map((row) => {
    if (!params.trimWhitespace) return row;
    const trimmed: Row = {};
    for (const h of headers) trimmed[h] = (row[h] ?? "").trim();
    return trimmed;
  });

  // Order-total-vs-line-items check runs on the ORIGINAL grouping before any
  // row removal below, so a row dropped for an unrelated reason (e.g. a
  // missing email) doesn't silently break a still-valid order's total check.
  const mismatchedGroupKeys = new Set<string>();
  if (params.checkOrderTotals) {
    const groupCol = headers.includes("Name") ? "Name" : headers.includes("Id") ? "Id" : null;
    if (groupCol) {
      const groups = new Map<string, { total: number | null; lineSum: number }>();
      for (const row of working) {
        const key = row[groupCol];
        if (!key) continue;
        const g = groups.get(key) ?? { total: null, lineSum: 0 };
        const totalStr = row["Total"];
        if (g.total === null && totalStr) {
          const t = Number(totalStr);
          if (!Number.isNaN(t)) g.total = t;
        }
        const price = Number(row["Lineitem price"]);
        const qty = Number(row["Lineitem quantity"]);
        if (!Number.isNaN(price) && !Number.isNaN(qty)) g.lineSum += price * qty;
        groups.set(key, g);
      }
      for (const [key, g] of groups) {
        if (g.total === null) continue; // no total to compare against -- not a mismatch, just unknown
        if (Math.abs(g.total - g.lineSum) > ORDER_TOTAL_TOLERANCE) {
          mismatchedGroupKeys.add(key);
        }
      }
      summary.orderTotalMismatches = mismatchedGroupKeys.size;

      if (params.excludeMismatchedOrders) {
        const before = working.length;
        working = working.filter((row) => !mismatchedGroupKeys.has(row[groupCol]));
        summary.removedMismatchedOrders = before - working.length;
      }
    }
  }

  if (params.dedupeExact) {
    const seen = new Set<string>();
    const before = working.length;
    working = working.filter((row) => {
      const key = headers.map((h) => row[h] ?? "").join("\u0001");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    summary.removedDuplicateExact = before - working.length;
  }

  if (params.dedupeByColumn) {
    const col = params.dedupeByColumn;
    const seen = new Set<string>();
    const before = working.length;
    working = working.filter((row) => {
      const value = row[col];
      if (!value) return true; // empty key -- nothing to dedupe against, keep it
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
    summary.removedDuplicateByColumn = before - working.length;
  }

  if (params.requiredColumns.length > 0) {
    const before = working.length;
    working = working.filter((row) => params.requiredColumns.every((col) => (row[col] ?? "").length > 0));
    summary.removedMissingRequired = before - working.length;
  }

  if (params.emailColumn && params.dropInvalidEmail) {
    const col = params.emailColumn;
    const before = working.length;
    working = working.filter((row) => !row[col] || EMAIL_VALID_RE.test(row[col]));
    summary.removedInvalidEmail = before - working.length;
  }
  if (params.emailColumn) {
    const col = params.emailColumn;
    working = working.map((row) => (row[col] ? { ...row, [col]: row[col].toLowerCase() } : row));
  }

  if (params.phoneColumn && params.dropInvalidPhone) {
    const col = params.phoneColumn;
    const before = working.length;
    working = working.filter((row) => {
      if (!row[col]) return true; // no phone at all is a different problem than an invalid one
      try {
        return parsePhoneNumberFromString(row[col])?.isValid() ?? false;
      } catch {
        return false;
      }
    });
    summary.removedInvalidPhone = before - working.length;
  }

  summary.outputRows = working.length;
  return { rows: working, summary };
}

export function toCsv(rows: Row[], headers: string[]): string {
  return Papa.unparse({ fields: headers, data: rows.map((row) => headers.map((h) => row[h] ?? "")) });
}
