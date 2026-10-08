import type { FieldDef } from "@/app/dashboard/segments/ConditionBuilder";

// Human-labeled conditions, mapped to the exact Shopify export column each
// one reads from -- the fix for "the segmentation we're providing is much
// more complex than the Shopify order segmentation we need to do in
// Excel" (a real client complaint): nobody building a segment should need
// to know the file's raw column is literally named "Lineitem name" or
// "Fulfillment Status". A curated, per-export-shape list instead of
// "whatever headers happen to be in this file" also means we never show a
// field that wouldn't make sense to filter on (e.g. an internal ID
// column).
export const CUSTOMER_FRIENDLY_FIELDS: FieldDef[] = [
  { key: "Total Orders", label: "Total orders", type: "number" },
  { key: "Total Spent", label: "Total spent", type: "number" },
];

// Orders export. Three kinds of field, all offered in one list:
//  - order fields (total, dates, status, payment method, discount, shipping address ...):
//    judged on the order itself;
//  - item fields (product, quantity, price, SKU, vendor): an order counts when ANY of its items
//    matches;
//  - customer fields (written "@..."): judged on the customer's whole order history.
// The wizard only offers the ones whose column is actually in the uploaded file.
export const ORDER_FRIENDLY_FIELDS: FieldDef[] = [
  // The customer, over all their orders
  { key: "@orders", label: "Customer: total orders", type: "number" },
  { key: "@totalSpent", label: "Customer: total spent", type: "number" },
  { key: "@avgOrderValue", label: "Customer: average order value", type: "number" },
  { key: "@recencyDays", label: "Customer: days since last order", type: "number" },
  { key: "@lastOrderDate", label: "Customer: last order date", type: "date" },
  // Items
  { key: "Lineitem name", label: "Product (any item in the order)", type: "text" },
  { key: "Lineitem quantity", label: "Item quantity", type: "number" },
  { key: "Lineitem price", label: "Item price", type: "number" },
  { key: "Lineitem sku", label: "Item SKU", type: "text" },
  { key: "Vendor", label: "Vendor", type: "text" },
  // The order
  { key: "Total", label: "Order total", type: "number" },
  { key: "Subtotal", label: "Order subtotal", type: "number" },
  { key: "Shipping", label: "Shipping charge", type: "number" },
  { key: "Taxes", label: "Taxes", type: "number" },
  { key: "Discount Code", label: "Discount code", type: "text" },
  { key: "Discount Amount", label: "Discount amount", type: "number" },
  { key: "Refunded Amount", label: "Refunded amount", type: "number" },
  { key: "Created at", label: "Order date", type: "date" },
  { key: "Paid at", label: "Paid date", type: "date" },
  { key: "Fulfilled at", label: "Fulfilled date", type: "date" },
  { key: "Cancelled at", label: "Cancelled date", type: "date" },
  { key: "Financial Status", label: "Payment status", type: "text" },
  { key: "Fulfillment Status", label: "Fulfillment status", type: "text" },
  { key: "Payment Method", label: "Payment method", type: "text" },
  { key: "Shipping Method", label: "Shipping method", type: "text" },
  { key: "Tags", label: "Order tags", type: "text" },
  { key: "Source", label: "Order source", type: "text" },
  { key: "Accepts Marketing", label: "Accepts marketing (yes/no)", type: "text" },
  { key: "Risk Level", label: "Risk level", type: "text" },
  { key: "Notes", label: "Order notes", type: "text" },
  { key: "Currency", label: "Currency", type: "text" },
  // Where it ships
  { key: "Shipping City", label: "Shipping city", type: "text" },
  { key: "Shipping Province Name", label: "Shipping state", type: "text" },
  { key: "Shipping Province", label: "Shipping state code", type: "text" },
  { key: "Shipping Zip", label: "Shipping pin code", type: "text" },
  { key: "Shipping Country", label: "Shipping country", type: "text" },
  { key: "Billing City", label: "Billing city", type: "text" },
  { key: "Billing Province Name", label: "Billing state", type: "text" },
  { key: "Billing Zip", label: "Billing pin code", type: "text" },
];

/** The fields to offer for an uploaded Orders file: customer fields always, the rest only when the
 *  column exists and has at least one value. */
export function orderFieldsPresentIn(rows: Record<string, string>[]): FieldDef[] {
  const sample = rows.slice(0, 2000);
  return ORDER_FRIENDLY_FIELDS.filter((f) => f.key.startsWith("@") || sample.some((r) => (r[f.key] ?? "") !== ""));
}
