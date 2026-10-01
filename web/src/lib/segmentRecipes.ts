import Papa from "papaparse";
import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

export type CleanedCustomer = {
  phone: string;
  email: string;
  firstName: string;
  lastName: string;
  countryCode: string;
};

export type SkipReason = "no_phone" | "invalid_phone";

export type RecipeResult = {
  customers: CleanedCustomer[];
  skipped: { reason: SkipReason; email: string }[];
};

// Shopify prefixes ID/phone columns with a literal single-quote in its
// export CSVs, to stop spreadsheet apps from mangling large numbers --
// e.g. a phone cell literally contains the text "'9930023314".
function stripLeadingQuote(v: string | undefined): string {
  if (!v) return "";
  return v.startsWith("'") ? v.slice(1) : v;
}

export function splitPhone(rawPhone: string, regionHint?: string): { national: string; countryCode: string } | null {
  if (!rawPhone) return null;
  try {
    const parsed = parsePhoneNumberFromString(rawPhone, regionHint as CountryCode | undefined);
    if (!parsed || !parsed.isValid()) return null;
    return { national: parsed.nationalNumber, countryCode: parsed.countryCallingCode };
  } catch {
    return null;
  }
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toConvertWayCsv(customers: CleanedCustomer[]): string {
  const header = "phone,email,first name,last name,country code";
  const rows = customers.map(
    (c) => `${c.phone},${csvEscape(c.email)},${csvEscape(c.firstName)},${csvEscape(c.lastName)},${c.countryCode}`
  );
  return [header, ...rows].join("\n");
}

// --- Customers export (Total Spent / Total Orders already pre-aggregated
// by Shopify -- no date info at all) ---

export type CustomerExportRow = Record<string, string>;

export function parseCustomersExport(csvText: string): CustomerExportRow[] {
  return Papa.parse<CustomerExportRow>(csvText, { header: true, skipEmptyLines: true }).data;
}

export function looksLikeCustomersExport(headers: string[]): boolean {
  return headers.includes("Total Orders") && headers.includes("Total Spent");
}

function customerRowToCleaned(row: CustomerExportRow): { cleaned: CleanedCustomer | null; skip: SkipReason | null } {
  // "Phone" is specifically the SMS-marketing-consented number and is often
  // blank; "Default Address Phone" (the checkout/address phone) is far more
  // commonly populated -- confirmed against real export data, not assumed.
  const rawPhone = stripLeadingQuote(row["Phone"]) || stripLeadingQuote(row["Default Address Phone"]);
  const region = row["Default Address Country Code"] || undefined;
  if (!rawPhone) return { cleaned: null, skip: "no_phone" };
  const split = splitPhone(rawPhone, region);
  if (!split) return { cleaned: null, skip: "invalid_phone" };
  return {
    cleaned: {
      phone: split.national,
      email: row["Email"] || "",
      firstName: row["First Name"] || "",
      lastName: row["Last Name"] || "",
      countryCode: split.countryCode,
    },
    skip: null,
  };
}

export function repeatCustomersRecipe(rows: CustomerExportRow[], minOrders: number): RecipeResult {
  const customers: CleanedCustomer[] = [];
  const skipped: RecipeResult["skipped"] = [];
  for (const row of rows) {
    if (Number(row["Total Orders"] || 0) < minOrders) continue;
    const { cleaned, skip } = customerRowToCleaned(row);
    if (cleaned) customers.push(cleaned);
    else if (skip) skipped.push({ reason: skip, email: row["Email"] || "" });
  }
  return { customers, skipped };
}

export function highAovRecipe(rows: CustomerExportRow[], minAov: number): RecipeResult {
  const customers: CleanedCustomer[] = [];
  const skipped: RecipeResult["skipped"] = [];
  for (const row of rows) {
    const totalOrders = Number(row["Total Orders"] || 0);
    if (totalOrders === 0) continue;
    const aov = Number(row["Total Spent"] || 0) / totalOrders;
    if (aov < minAov) continue;
    const { cleaned, skip } = customerRowToCleaned(row);
    if (cleaned) customers.push(cleaned);
    else if (skip) skipped.push({ reason: skip, email: row["Email"] || "" });
  }
  return { customers, skipped };
}

// --- Orders export (has dates, but one row per LINE ITEM -- order-level
// fields like Total/Phone are only filled on a multi-item order's first
// row, blank on every continuation row) ---

export type OrderExportRow = Record<string, string>;

export function parseOrdersExport(csvText: string): OrderExportRow[] {
  return Papa.parse<OrderExportRow>(csvText, { header: true, skipEmptyLines: true }).data;
}

export function looksLikeOrdersExport(headers: string[]): boolean {
  return headers.includes("Lineitem name") && headers.includes("Created at");
}

// Keeps only the first row seen per order Name -- that's the one row per
// order that actually has the order-level fields filled in.
function collapseToOrders(rows: OrderExportRow[]): OrderExportRow[] {
  const orders = new Map<string, OrderExportRow>();
  for (const row of rows) {
    if (!orders.has(row["Name"])) {
      orders.set(row["Name"], row);
    }
  }
  return Array.from(orders.values());
}

export function winbackRecipe(rows: OrderExportRow[], minDaysAgo: number, maxDaysAgo: number): RecipeResult {
  const orders = collapseToOrders(rows);

  const byEmail = new Map<string, OrderExportRow[]>();
  for (const order of orders) {
    if (!order["Email"]) continue;
    const list = byEmail.get(order["Email"]) ?? [];
    list.push(order);
    byEmail.set(order["Email"], list);
  }

  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const customers: CleanedCustomer[] = [];
  const skipped: RecipeResult["skipped"] = [];

  for (const [email, customerOrders] of byEmail) {
    let latestOrder = customerOrders[0];
    let latestTime = new Date(latestOrder["Created at"]).getTime();
    for (const o of customerOrders) {
      const t = new Date(o["Created at"]).getTime();
      if (t > latestTime) {
        latestTime = t;
        latestOrder = o;
      }
    }

    const daysAgo = (now - latestTime) / msPerDay;
    if (daysAgo < minDaysAgo || daysAgo > maxDaysAgo) continue;

    const rawPhone = latestOrder["Phone"] || latestOrder["Billing Phone"] || "";
    const region = latestOrder["Billing Country"] || undefined;
    if (!rawPhone) {
      skipped.push({ reason: "no_phone", email });
      continue;
    }
    const split = splitPhone(rawPhone, region);
    if (!split) {
      skipped.push({ reason: "invalid_phone", email });
      continue;
    }

    const [firstName, ...rest] = (latestOrder["Billing Name"] || "").split(" ");
    customers.push({
      phone: split.national,
      email,
      firstName: firstName || "",
      lastName: rest.join(" "),
      countryCode: split.countryCode,
    });
  }

  return { customers, skipped };
}

// Shared by productRecipe and customRecipe below: given already-collapsed
// one-row-per-order rows, pick the single most recent order per customer
// (email) and turn it into a CleanedCustomer -- same contact-extraction
// logic winbackRecipe uses above, factored out so both recipes stay
// consistent with it rather than drifting.
function latestOrderPerCustomer(orders: OrderExportRow[]): RecipeResult {
  const byEmail = new Map<string, OrderExportRow[]>();
  for (const order of orders) {
    if (!order["Email"]) continue;
    const list = byEmail.get(order["Email"]) ?? [];
    list.push(order);
    byEmail.set(order["Email"], list);
  }

  const customers: CleanedCustomer[] = [];
  const skipped: RecipeResult["skipped"] = [];

  for (const [email, customerOrders] of byEmail) {
    let latestOrder = customerOrders[0];
    let latestTime = new Date(latestOrder["Created at"]).getTime();
    for (const o of customerOrders) {
      const t = new Date(o["Created at"]).getTime();
      if (t > latestTime) {
        latestTime = t;
        latestOrder = o;
      }
    }

    const rawPhone = latestOrder["Phone"] || latestOrder["Billing Phone"] || "";
    const region = latestOrder["Billing Country"] || undefined;
    if (!rawPhone) {
      skipped.push({ reason: "no_phone", email });
      continue;
    }
    const split = splitPhone(rawPhone, region);
    if (!split) {
      skipped.push({ reason: "invalid_phone", email });
      continue;
    }

    const [firstName, ...rest] = (latestOrder["Billing Name"] || "").split(" ");
    customers.push({
      phone: split.national,
      email,
      firstName: firstName || "",
      lastName: rest.join(" "),
      countryCode: split.countryCode,
    });
  }

  return { customers, skipped };
}

// "Bought Product(s)" -- the product-based counterpart to Repeat Customers/
// High AOV/Win-back. Needs an Orders export specifically: a Customers
// export has no per-order product info at all.
export function productRecipe(rows: OrderExportRow[], products: string[]): RecipeResult {
  const matchingLineItems = rows.filter((r) => products.includes(r["Lineitem name"]));
  const orders = collapseToOrders(matchingLineItems);
  return latestOrderPerCustomer(orders);
}

export type ConditionOperator = "gte" | "lte" | "eq" | "contains";

export type FilterCondition = {
  column: string;
  operator: ConditionOperator;
  value: string;
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  gte: "is at least",
  lte: "is at most",
  eq: "is exactly",
  contains: "contains",
};

function rowMatchesConditions(row: Record<string, string>, conditions: FilterCondition[]): boolean {
  return conditions.every((c) => {
    const raw = row[c.column] ?? "";
    if (c.operator === "contains") return raw.toLowerCase().includes(c.value.toLowerCase());

    const num = Number(raw);
    const target = Number(c.value);
    if (!Number.isNaN(num) && !Number.isNaN(target)) {
      if (c.operator === "eq") return num === target;
      if (c.operator === "gte") return num >= target;
      if (c.operator === "lte") return num <= target;
    }
    // Falls back to plain string comparison -- works correctly for ISO
    // dates (e.g. "2026-09-01" >= "2026-08-01" compares right as strings)
    // and is at least a sane fallback for anything else non-numeric.
    if (c.operator === "eq") return raw === c.value;
    if (c.operator === "gte") return raw >= c.value;
    if (c.operator === "lte") return raw <= c.value;
    return false;
  });
}

// The fully custom path: the user picks their own column/operator/value
// conditions instead of one of the built-in recipes above. Works against
// either export shape -- Orders rows are collapsed to one-per-order first
// (same reasoning as every other Orders-export recipe), Customers rows are
// used as-is since they're already one row per customer.
export function customRecipe(
  rows: Record<string, string>[],
  conditions: FilterCondition[],
  shape: "customers" | "orders"
): RecipeResult {
  const candidateRows = shape === "orders" ? collapseToOrders(rows as OrderExportRow[]) : rows;
  const matched = candidateRows.filter((r) => rowMatchesConditions(r, conditions));

  if (shape === "orders") {
    return latestOrderPerCustomer(matched as OrderExportRow[]);
  }

  const customers: CleanedCustomer[] = [];
  const skipped: RecipeResult["skipped"] = [];
  for (const row of matched as CustomerExportRow[]) {
    const { cleaned, skip } = customerRowToCleaned(row);
    if (cleaned) customers.push(cleaned);
    else if (skip) skipped.push({ reason: skip, email: row["Email"] || "" });
  }
  return { customers, skipped };
}
