import Papa from "papaparse";
import { parsePhoneNumberFromString, CountryCode } from "libphonenumber-js";

// --- Shared types ---------------------------------------------------------

export type PhoneIssue = "no_phone" | "invalid_phone" | null;

// One customer, whichever export it came from. `phone`/`countryCode` are
// empty strings when the number is missing or invalid (phoneIssue says why)
// -- whether that excludes them is decided at output time, because a template
// with no phone column shouldn't drop people over a phone they won't export.
export type SegmentCustomer = {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  countryCode: string;
  phoneIssue: PhoneIssue;
  orders: number;
  totalSpent: number;
  lastOrderDate: string; // ISO date, "" when unknown (Customers export has no dates)
  recencyDays: number | null;
};

export type ExportRow = Record<string, string>;
export type CustomerExportRow = ExportRow;
export type OrderExportRow = ExportRow;
export type ExportShape = "customers" | "orders";

// --- Phone / contact helpers ---------------------------------------------

// Shopify prefixes ID/phone columns with a literal single-quote in its
// export CSVs, to stop spreadsheet apps from mangling large numbers.
function stripLeadingQuote(v: string | undefined): string {
  if (!v) return "";
  return v.startsWith("'") ? v.slice(1) : v;
}

// Indian mobile numbers are written many ways: 9876543210, 919876543210, +91 98765 43210,
// 91-98765-43210, 09876543210, 0091..., even "9191..." typed twice. All of them are cleaned
// to the 10-digit number plus country code 91, instead of being rejected. Anything that is
// not a plausible Indian mobile (starts with 6-9, exactly 10 digits) is left to the general
// international parser below.
function cleanIndianMobile(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");
  while (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  return digits.length === 10 && /^[6-9]/.test(digits) ? digits : null;
}

export function splitPhone(rawPhone: string, regionHint?: string): { national: string; countryCode: string } | null {
  if (!rawPhone) return null;
  // Excel turns long numbers into scientific notation ("9.17235E+11"): the digits are gone.
  if (/e\+/i.test(rawPhone)) return null;
  const region = (regionHint || "").toUpperCase();
  const plus = rawPhone.trim().startsWith("+");
  if ((region === "" || region === "IN") && (!plus || rawPhone.trim().startsWith("+91"))) {
    const indian = cleanIndianMobile(rawPhone);
    if (indian) return { national: indian, countryCode: "91" };
  }
  try {
    const parsed = parsePhoneNumberFromString(rawPhone, regionHint as CountryCode | undefined);
    if (!parsed || !parsed.isValid()) return null;
    return { national: parsed.nationalNumber, countryCode: parsed.countryCallingCode };
  } catch {
    return null;
  }
}

function phoneParts(rawPhone: string, region?: string): Pick<SegmentCustomer, "phone" | "countryCode" | "phoneIssue"> {
  if (!rawPhone) return { phone: "", countryCode: "", phoneIssue: "no_phone" };
  const split = splitPhone(rawPhone, region);
  if (!split) return { phone: "", countryCode: "", phoneIssue: "invalid_phone" };
  return { phone: split.national, countryCode: split.countryCode, phoneIssue: null };
}

// --- Parsing --------------------------------------------------------------

// Reads a CSV file chosen in the browser. Shopify exports are UTF-8, but a file that was
// opened and saved again in Excel is usually Windows-1252 (a dash in a product name becomes
// an invalid byte). Reading that as UTF-8 garbles names, so fall back to Windows-1252.
export async function readCsvFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export function parseExport(csvText: string): { rows: ExportRow[]; headers: string[] } {
  const result = Papa.parse<ExportRow>(csvText, { header: true, skipEmptyLines: true });
  return { rows: result.data, headers: result.meta.fields ?? [] };
}

export function parseCustomersExport(csvText: string): CustomerExportRow[] {
  return parseExport(csvText).rows;
}

export function parseOrdersExport(csvText: string): OrderExportRow[] {
  return parseExport(csvText).rows;
}

export function looksLikeCustomersExport(headers: string[]): boolean {
  return headers.includes("Total Orders") && headers.includes("Total Spent");
}

export function looksLikeOrdersExport(headers: string[]): boolean {
  return headers.includes("Lineitem name") && headers.includes("Created at");
}

export function detectShape(headers: string[]): ExportShape | null {
  if (looksLikeOrdersExport(headers)) return "orders";
  if (looksLikeCustomersExport(headers)) return "customers";
  return null;
}

// --- Customers export -> customers ---------------------------------------

function customerFromCustomerRow(row: CustomerExportRow): SegmentCustomer {
  // "Phone" is the SMS-consented number and often blank; "Default Address
  // Phone" is far more commonly populated.
  const rawPhone = stripLeadingQuote(row["Phone"]) || stripLeadingQuote(row["Default Address Phone"]);
  return {
    email: row["Email"] || "",
    firstName: row["First Name"] || "",
    lastName: row["Last Name"] || "",
    ...phoneParts(rawPhone, row["Default Address Country Code"] || undefined),
    orders: Number(row["Total Orders"] || 0),
    totalSpent: Number(row["Total Spent"] || 0),
    lastOrderDate: "",
    recencyDays: null,
  };
}

// --- Orders export -> customers ------------------------------------------
// The Orders export has one row per LINE ITEM; order-level fields (Email,
// Total, Phone...) are filled only on an order's first row.

function collapseToOrders(rows: OrderExportRow[]): OrderExportRow[] {
  const orders = new Map<string, OrderExportRow>();
  for (const row of rows) {
    if (!orders.has(row["Name"])) orders.set(row["Name"], row);
  }
  return Array.from(orders.values());
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type OrderProfile = SegmentCustomer & { products: Set<string>; key: string };

// Shopify writes a line item as "Product title - Variant" (for example
// "Light Grey Cotton Chinos Pant - M/30"). Segments work on the PRODUCT, so every size and
// colour of a product counts as that product: ticking it once includes all its variants.
export function productBase(lineItemName: string): string {
  const t = lineItemName.trim();
  const i = t.lastIndexOf(" - ");
  return i > 0 ? t.slice(0, i).trim() : t;
}

// One customer = one email (any letter case). Orders without an email -- common with
// cash-on-delivery checkouts -- are kept and matched by phone, then by name, instead of
// being dropped.
export function customerIdOf(order: OrderExportRow): string {
  const email = (order["Email"] || "").trim().toLowerCase();
  if (email) return `e:${email}`;
  const digits = (order["Phone"] || order["Billing Phone"] || order["Shipping Phone"] || "").replace(/\D/g, "");
  if (digits.length >= 7) return `p:${digits.slice(-10)}`;
  const name = (order["Billing Name"] || order["Shipping Name"] || "").trim().toLowerCase();
  return name ? `n:${name}` : `o:${order["Name"]}`;
}

// One profile per customer (grouped by email): order count, spend, latest
// order date, contact details from their most recent order, and every
// distinct product they ever bought.
export function buildOrderProfiles(rows: OrderExportRow[], now: number = Date.now()): OrderProfile[] {
  const orders = collapseToOrders(rows);
  const idByOrder = new Map<string, string>();
  for (const o of orders) idByOrder.set(o["Name"], customerIdOf(o));

  const productsById = new Map<string, Set<string>>();
  for (const row of rows) {
    const title = productBase(row["Lineitem name"] || "");
    const id = idByOrder.get(row["Name"]);
    if (!title || !id) continue;
    const set = productsById.get(id) ?? new Set<string>();
    set.add(title);
    productsById.set(id, set);
  }

  const byCustomer = new Map<string, OrderExportRow[]>();
  for (const order of orders) {
    const id = idByOrder.get(order["Name"])!;
    const list = byCustomer.get(id) ?? [];
    list.push(order);
    byCustomer.set(id, list);
  }

  const profiles: OrderProfile[] = [];
  for (const [id, customerOrders] of byCustomer) {
    let latest = customerOrders[0];
    let latestTime = new Date(latest["Created at"]).getTime();
    let totalSpent = 0;
    for (const o of customerOrders) {
      totalSpent += Number(o["Total"] || 0);
      const t = new Date(o["Created at"]).getTime();
      if (t > latestTime) {
        latestTime = t;
        latest = o;
      }
    }
    // Name comes from the latest order; the phone from the most recent order
    // that actually has one -- a newest order checked out without a number
    // shouldn't lose a customer whose earlier order had it.
    const newestFirst = [...customerOrders].sort(
      (x, y) => new Date(y["Created at"]).getTime() - new Date(x["Created at"]).getTime()
    );
    const phone = bestPhone(newestFirst);
    const [firstName, ...rest] = (latest["Billing Name"] || "").split(" ");
    const validTime = !Number.isNaN(latestTime);
    profiles.push({
      key: id,
      email: customerOrders.map((o) => o["Email"]).find(Boolean) ?? "",
      firstName: firstName || "",
      lastName: rest.join(" "),
      ...phone,
      orders: customerOrders.length,
      totalSpent,
      lastOrderDate: validTime ? new Date(latestTime).toISOString().slice(0, 10) : "",
      recencyDays: validTime ? Math.max(0, Math.floor((now - latestTime) / MS_PER_DAY)) : null,
      products: productsById.get(id) ?? new Set(),
    });
  }
  return profiles;
}

// Looks through a customer's orders, newest first, and through every phone column an order
// has (Phone, Billing Phone, Shipping Phone), and takes the first number that is valid.
// Values that Excel has turned into scientific notation ("9.17235E+11") are skipped: the
// digits are already lost and can't be recovered. A customer is "no phone" only when no order
// has any phone value at all, otherwise "invalid phone".
function bestPhone(newestFirst: OrderExportRow[]): Pick<SegmentCustomer, "phone" | "countryCode" | "phoneIssue"> {
  let sawAny = false;
  for (const o of newestFirst) {
    const region = o["Billing Country"] || o["Shipping Country"] || undefined;
    for (const col of ["Phone", "Billing Phone", "Shipping Phone"]) {
      const raw = stripLeadingQuote(o[col]).trim();
      if (!raw) continue;
      sawAny = true;
      if (/e\+/i.test(raw)) continue;
      const split = splitPhone(raw, region);
      if (split) return { phone: split.national, countryCode: split.countryCode, phoneIssue: null };
    }
  }
  return { phone: "", countryCode: "", phoneIssue: sawAny ? "invalid_phone" : "no_phone" };
}

export function distinctProducts(rows: OrderExportRow[]): string[] {
  const titles = new Set<string>();
  for (const row of rows) {
    const title = productBase(row["Lineitem name"] || "");
    if (title) titles.add(title);
  }
  return Array.from(titles).sort((a, b) => a.localeCompare(b));
}

// --- RFM tiers ------------------------------------------------------------

export type RfmTier = "vip" | "at_risk" | "lapsed" | "new" | "big_spenders";

export type RfmParams = {
  vipOrders: number; // VIP: at least this many orders...
  recentDays: number; // ...and ordered within this many days. Also "new"'s recency window.
  lapsedDays: number; // Lapsed: no order for more than this many days. At risk sits between recent and lapsed.
  minSpend: number; // Big spenders: lifetime spend at least this
};

export const DEFAULT_RFM_PARAMS: RfmParams = { vipOrders: 3, recentDays: 90, lapsedDays: 180, minSpend: 0 };

export const RFM_TIER_LABELS: Record<RfmTier, string> = {
  vip: "VIP",
  at_risk: "At risk",
  lapsed: "Lapsed",
  new: "New",
  big_spenders: "Big spenders",
};

export function suggestMinSpend(profiles: SegmentCustomer[]): number {
  if (profiles.length === 0) return 0;
  const avg = profiles.reduce((sum, p) => sum + p.totalSpent, 0) / profiles.length;
  return Math.round((avg * 2) / 100) * 100 || Math.round(avg * 2);
}

export function rfmRecipe(profiles: SegmentCustomer[], tier: RfmTier, params: RfmParams): SegmentCustomer[] {
  return profiles.filter((p) => {
    const recency = p.recencyDays;
    if (tier === "big_spenders") return p.totalSpent >= params.minSpend;
    if (recency === null) return false;
    switch (tier) {
      case "vip":
        return p.orders >= params.vipOrders && recency <= params.recentDays;
      case "at_risk":
        return p.orders >= 2 && recency > params.recentDays && recency <= params.lapsedDays;
      case "lapsed":
        return recency > params.lapsedDays;
      case "new":
        return p.orders === 1 && recency <= params.recentDays;
    }
  });
}

// --- Product affinity -----------------------------------------------------

export type AffinityMode = "bought_any" | "bought_all" | "never_bought" | "bought_not";

export const AFFINITY_MODE_LABELS: Record<AffinityMode, string> = {
  bought_any: "Bought any of",
  bought_all: "Bought all of",
  never_bought: "Never bought",
  bought_not: "Bought, but not",
};

export function affinityRecipe(
  profiles: OrderProfile[],
  mode: AffinityMode,
  include: string[],
  exclude: string[] = []
): SegmentCustomer[] {
  if (include.length === 0) return [];
  return profiles
    .filter((p) => {
      const hasAny = include.some((t) => p.products.has(t));
      switch (mode) {
        case "bought_any":
          return hasAny;
        case "bought_all":
          return include.every((t) => p.products.has(t));
        case "never_bought":
          return !hasAny;
        case "bought_not":
          return hasAny && !exclude.some((t) => p.products.has(t));
      }
    })
    .map(stripProducts);
}

function stripProducts(p: OrderProfile): SegmentCustomer {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { products, ...customer } = p;
  return customer;
}

// --- Custom conditions ----------------------------------------------------

export type ConditionOperator = "gte" | "lte" | "eq" | "contains" | "not_contains";

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
  not_contains: "does not contain",
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function rowMatchesConditions(row: ExportRow, conditions: FilterCondition[]): boolean {
  return conditions.every((c) => {
    let raw = row[c.column] ?? "";
    if (c.operator === "contains") return raw.toLowerCase().includes(c.value.toLowerCase());
    if (c.operator === "not_contains") return !raw.toLowerCase().includes(c.value.toLowerCase());
    // A date picked in the form ("2026-10-05") is compared with the DAY of a timestamp such as
    // "2026-10-05 14:02:24 +0530", so "on or before 5 Oct" includes orders placed that afternoon.
    if (ISO_DAY.test(c.value) && /^\d{4}-\d{2}-\d{2}/.test(raw)) raw = raw.slice(0, 10);

    const num = Number(raw);
    const target = Number(c.value);
    if (raw !== "" && c.value !== "" && !Number.isNaN(num) && !Number.isNaN(target)) {
      if (c.operator === "eq") return num === target;
      if (c.operator === "gte") return num >= target;
      if (c.operator === "lte") return num <= target;
    }
    // Plain string comparison also compares ISO dates correctly.
    if (c.operator === "eq") return raw === c.value;
    if (c.operator === "gte") return raw >= c.value;
    if (c.operator === "lte") return raw <= c.value;
    return false;
  });
}

// Columns that belong to ONE LINE ITEM of an order. The export repeats the order on one row
// per item, so a condition on these is true for an order when ANY of its items satisfies it
// (an order whose second item is a cotton pant still counts), instead of looking only at the
// order's first row.
const LINE_LEVEL_COLUMNS = new Set([
  "Lineitem name",
  "Lineitem quantity",
  "Lineitem price",
  "Lineitem compare at price",
  "Lineitem sku",
  "Lineitem discount",
  "Lineitem fulfillment status",
  "Lineitem requires shipping",
  "Lineitem taxable",
  "Vendor",
]);

// Conditions on the CUSTOMER as a whole (all their orders), written "@field" in a condition.
export const PROFILE_FIELDS = ["@orders", "@totalSpent", "@recencyDays", "@lastOrderDate", "@avgOrderValue"] as const;

function profileRecord(p: SegmentCustomer): ExportRow {
  return {
    "@orders": String(p.orders),
    "@totalSpent": String(p.totalSpent),
    "@recencyDays": p.recencyDays === null ? "" : String(p.recencyDays),
    "@lastOrderDate": p.lastOrderDate,
    "@avgOrderValue": p.orders > 0 ? String(p.totalSpent / p.orders) : "",
  };
}

// Fully custom: the user's own column/operator/value conditions, against either export shape.
//  - order and item conditions pick the ORDERS that match (all of them on the same order);
//    every customer with at least one matching order is included;
//  - customer conditions ("@orders" ...) are then checked against each customer's WHOLE
//    history (all their orders, not only the matching ones), and the customer's order count
//    and spend in the result are likewise for their whole history.
export function customRecipe(
  rows: ExportRow[],
  conditions: FilterCondition[],
  shape: ExportShape,
  now: number = Date.now(),
  profiles?: OrderProfile[] | null
): SegmentCustomer[] {
  if (shape === "customers") {
    return rows.filter((r) => rowMatchesConditions(r, conditions)).map(customerFromCustomerRow);
  }
  const profileConds = conditions.filter((c) => c.column.startsWith("@"));
  const rowConds = conditions.filter((c) => !c.column.startsWith("@"));
  const lineConds = rowConds.filter((c) => LINE_LEVEL_COLUMNS.has(c.column));
  const orderConds = rowConds.filter((c) => !LINE_LEVEL_COLUMNS.has(c.column));

  const all = profiles ?? buildOrderProfiles(rows, now);
  let allowed: Set<string> | null = null;
  if (rowConds.length > 0) {
    const byOrder = new Map<string, OrderExportRow[]>();
    for (const r of rows) {
      const list = byOrder.get(r["Name"]) ?? [];
      list.push(r);
      byOrder.set(r["Name"], list);
    }
    allowed = new Set<string>();
    for (const lines of byOrder.values()) {
      const head = lines[0];
      if (orderConds.length > 0 && !rowMatchesConditions(head, orderConds)) continue;
      // Every line-level condition must be met by some item; items are tested one condition at
      // a time, so "product contains cotton AND quantity at least 2" can be met by different items.
      if (lineConds.length > 0 && !lineConds.every((c) => lines.some((l) => rowMatchesConditions(l, [c])))) continue;
      allowed.add(customerIdOf(head));
    }
  }
  return all
    .filter((p) => (allowed === null || allowed.has(p.key)) && (profileConds.length === 0 || rowMatchesConditions(profileRecord(p), profileConds)))
    .map(stripProducts);
}

// --- Output template mapping ---------------------------------------------

export type OutputField =
  | "phone"
  | "phoneWithCode"
  | "countryCode"
  | "email"
  | "firstName"
  | "lastName"
  | "fullName"
  | "orders"
  | "totalSpent"
  | "lastOrderDate"
  | "recencyDays";

export const OUTPUT_FIELDS: { key: OutputField; label: string }[] = [
  { key: "phone", label: "Phone (without country code)" },
  { key: "countryCode", label: "Country code" },
  { key: "phoneWithCode", label: "Phone with country code" },
  { key: "email", label: "Email" },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "fullName", label: "Full name" },
  { key: "orders", label: "Order count" },
  { key: "totalSpent", label: "Total spent" },
  { key: "lastOrderDate", label: "Last order date" },
  { key: "recencyDays", label: "Days since last order" },
];

const PHONE_FIELDS: OutputField[] = ["phone", "phoneWithCode", "countryCode"];

const HEADER_SYNONYMS: Record<OutputField, string[]> = {
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "contact", "contactnumber", "whatsapp", "whatsappnumber"],
  phoneWithCode: ["phonewithcountrycode", "fullphone", "e164", "phonee164", "mobilewithcountrycode"],
  countryCode: ["countrycode", "cc", "dialcode", "isdcode", "callingcode"],
  email: ["email", "emailaddress", "mail", "emailid"],
  firstName: ["firstname", "fname", "givenname"],
  lastName: ["lastname", "lname", "surname", "familyname"],
  fullName: ["name", "fullname", "customername"],
  orders: ["orders", "ordercount", "totalorders", "numberoforders"],
  totalSpent: ["totalspent", "ltv", "lifetimevalue", "totalspend", "spend", "revenue"],
  lastOrderDate: ["lastorderdate", "lastorder", "lastpurchase", "lastpurchasedate"],
  recencyDays: ["recency", "recencydays", "dayssincelastorder", "dayssincelastpurchase"],
};

const normalizeHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

// Best-effort guess so the common case needs no manual mapping; "" = leave
// that template column blank.
export function guessField(header: string): OutputField | "" {
  const n = normalizeHeader(header);
  for (const field of Object.keys(HEADER_SYNONYMS) as OutputField[]) {
    if (HEADER_SYNONYMS[field].includes(n)) return field;
  }
  return "";
}

export function parseTemplateHeaders(csvText: string): string[] {
  const result = Papa.parse<string[]>(csvText, { header: false, preview: 1, skipEmptyLines: true });
  return (result.data[0] ?? []).map((h) => h.trim()).filter(Boolean);
}

function fieldValue(c: SegmentCustomer, field: OutputField): string {
  switch (field) {
    case "phone":
      return c.phone;
    case "countryCode":
      return c.countryCode;
    case "phoneWithCode":
      return c.phone ? `+${c.countryCode}${c.phone}` : "";
    case "email":
      return c.email;
    case "firstName":
      return c.firstName;
    case "lastName":
      return c.lastName;
    case "fullName":
      return `${c.firstName} ${c.lastName}`.trim();
    case "orders":
      return String(c.orders);
    case "totalSpent":
      return c.totalSpent ? c.totalSpent.toFixed(2) : "0";
    case "lastOrderDate":
      return c.lastOrderDate;
    case "recencyDays":
      return c.recencyDays === null ? "" : String(c.recencyDays);
  }
}

export type OutputResult = {
  csv: string;
  rows: string[][];
  exported: number;
  skippedNoPhone: number;
  skippedInvalidPhone: number;
};

// The plain "just give me the list" export, before any output template:
// every customer in the segment with the standard fields, nobody dropped
// for a missing or invalid phone (the phone columns are simply blank).
const LIST_COLUMNS: { header: string; field: OutputField }[] = [
  { header: "Email", field: "email" },
  { header: "First name", field: "firstName" },
  { header: "Last name", field: "lastName" },
  { header: "Phone", field: "phone" },
  { header: "Country code", field: "countryCode" },
  { header: "Orders", field: "orders" },
  { header: "Total spent", field: "totalSpent" },
  { header: "Last order date", field: "lastOrderDate" },
  { header: "Days since last order", field: "recencyDays" },
];

export function buildListCsv(customers: SegmentCustomer[]): string {
  return buildOutput(
    customers,
    LIST_COLUMNS.map((c) => c.header),
    LIST_COLUMNS.map((c) => c.field),
    { keepWithoutPhone: true }
  ).csv;
}

// `mapping[i]` is the field for template column i ("" = blank). When any
// mapped column is a phone field, customers without a usable number are left
// out and counted -- never silently dropped, never exported with a blank
// phone the destination would reject.
export function buildOutput(
  customers: SegmentCustomer[],
  headers: string[],
  mapping: (OutputField | "")[],
  options: { keepWithoutPhone?: boolean } = {}
): OutputResult {
  const needsPhone = !options.keepWithoutPhone && mapping.some((f) => f !== "" && PHONE_FIELDS.includes(f));
  let skippedNoPhone = 0;
  let skippedInvalidPhone = 0;
  const rows: string[][] = [];
  for (const c of customers) {
    if (needsPhone && c.phoneIssue) {
      if (c.phoneIssue === "no_phone") skippedNoPhone++;
      else skippedInvalidPhone++;
      continue;
    }
    rows.push(mapping.map((f) => (f === "" ? "" : fieldValue(c, f))));
  }
  return {
    csv: Papa.unparse([headers, ...rows]),
    rows,
    exported: rows.length,
    skippedNoPhone,
    skippedInvalidPhone,
  };
}
