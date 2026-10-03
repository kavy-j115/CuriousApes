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

function phoneParts(rawPhone: string, region?: string): Pick<SegmentCustomer, "phone" | "countryCode" | "phoneIssue"> {
  if (!rawPhone) return { phone: "", countryCode: "", phoneIssue: "no_phone" };
  const split = splitPhone(rawPhone, region);
  if (!split) return { phone: "", countryCode: "", phoneIssue: "invalid_phone" };
  return { phone: split.national, countryCode: split.countryCode, phoneIssue: null };
}

// --- Parsing --------------------------------------------------------------

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

export type OrderProfile = SegmentCustomer & { products: Set<string> };

// One profile per customer (grouped by email): order count, spend, latest
// order date, contact details from their most recent order, and every
// distinct product they ever bought.
export function buildOrderProfiles(rows: OrderExportRow[], now: number = Date.now()): OrderProfile[] {
  const orders = collapseToOrders(rows);
  const emailByOrder = new Map<string, string>();
  for (const o of orders) emailByOrder.set(o["Name"], o["Email"] || "");

  const productsByEmail = new Map<string, Set<string>>();
  for (const row of rows) {
    const title = (row["Lineitem name"] || "").trim();
    const email = emailByOrder.get(row["Name"]);
    if (!title || !email) continue;
    const set = productsByEmail.get(email) ?? new Set<string>();
    set.add(title);
    productsByEmail.set(email, set);
  }

  const byEmail = new Map<string, OrderExportRow[]>();
  for (const order of orders) {
    const email = order["Email"];
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(order);
    byEmail.set(email, list);
  }

  const profiles: OrderProfile[] = [];
  for (const [email, customerOrders] of byEmail) {
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
    const withPhone = newestFirst.find((o) => o["Phone"] || o["Billing Phone"]) ?? latest;
    const [firstName, ...rest] = (latest["Billing Name"] || "").split(" ");
    const validTime = !Number.isNaN(latestTime);
    profiles.push({
      email,
      firstName: firstName || "",
      lastName: rest.join(" "),
      ...phoneParts(withPhone["Phone"] || withPhone["Billing Phone"] || "", withPhone["Billing Country"] || undefined),
      orders: customerOrders.length,
      totalSpent,
      lastOrderDate: validTime ? new Date(latestTime).toISOString().slice(0, 10) : "",
      recencyDays: validTime ? Math.max(0, Math.floor((now - latestTime) / MS_PER_DAY)) : null,
      products: productsByEmail.get(email) ?? new Set(),
    });
  }
  return profiles;
}

export function distinctProducts(rows: OrderExportRow[]): string[] {
  const titles = new Set<string>();
  for (const row of rows) {
    const title = (row["Lineitem name"] || "").trim();
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

function rowMatchesConditions(row: ExportRow, conditions: FilterCondition[]): boolean {
  return conditions.every((c) => {
    const raw = row[c.column] ?? "";
    if (c.operator === "contains") return raw.toLowerCase().includes(c.value.toLowerCase());

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

// Fully custom: the user's own column/operator/value conditions, against
// either export shape. Orders rows are filtered per ORDER (one row each), and
// every customer with at least one matching order is returned.
export function customRecipe(rows: ExportRow[], conditions: FilterCondition[], shape: ExportShape, now: number = Date.now()): SegmentCustomer[] {
  if (shape === "customers") {
    return rows.filter((r) => rowMatchesConditions(r, conditions)).map(customerFromCustomerRow);
  }
  const matchingOrders = collapseToOrders(rows).filter((r) => rowMatchesConditions(r, conditions));
  const matchingNames = new Set(matchingOrders.map((o) => o["Name"]));
  const filteredRows = rows.filter((r) => matchingNames.has(r["Name"]));
  return buildOrderProfiles(filteredRows, now).map(stripProducts);
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
