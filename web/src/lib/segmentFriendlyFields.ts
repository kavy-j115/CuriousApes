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

export const ORDER_FRIENDLY_FIELDS: FieldDef[] = [
  { key: "Total", label: "Order total", type: "number" },
  { key: "Created at", label: "Order date", type: "date" },
  { key: "Lineitem name", label: "Product", type: "text" },
  { key: "Financial Status", label: "Payment status", type: "text" },
  { key: "Fulfillment Status", label: "Fulfillment status", type: "text" },
  { key: "Cancelled at", label: "Cancelled date", type: "date" },
];
