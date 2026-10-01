// Kept in its own file (not inside dataActions.ts) because that file has
// "use server" at the top, and Next.js requires every export of a
// "use server" file to be an async function -- a plain constant like this
// isn't allowed there, even though it's genuinely related.
export const CUSTOMER_FIELDS: { key: "order_count" | "lifetime_value" | "first_order_date" | "last_order_date"; label: string; type: "number" | "date" }[] = [
  { key: "order_count", label: "Order count", type: "number" },
  { key: "lifetime_value", label: "Lifetime value", type: "number" },
  { key: "first_order_date", label: "First order date", type: "date" },
  { key: "last_order_date", label: "Last order date", type: "date" },
];

export type CustomerCondition = {
  field: "order_count" | "lifetime_value" | "first_order_date" | "last_order_date";
  operator: "gte" | "lte" | "eq";
  value: string;
};
