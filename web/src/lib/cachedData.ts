import { unstable_cache } from "next/cache";
import { getAdminClient } from "@/lib/supabase/admin";

// Page data that only changes when the daily sync runs, kept for a few minutes so
// switching between pages, clients and ranges does not repeat the same slow trips to the
// database (each web-API call costs ~300 ms, and the customer / retention figures are
// calculated from every order on every request).
//
// ACCESS: these read with the service role, so they BYPASS row-level security. The
// callers must only pass a client id taken from the logged-in user's own (RLS-filtered)
// clients list -- never one straight from the URL. `assertListed` enforces that here.
const TTL_SECONDS = 600;

export function assertListed(clientId: string, clients: { client_id: string }[]): void {
  if (!clients.some((c) => c.client_id === clientId)) throw new Error("No access to this client.");
}

type Rows = Record<string, unknown>[];

export type DashboardData = {
  metrics: Rows;
  totalCustomers: number;
  repeatCustomers: number;
  retention: Rows;
  newVsReturning: Rows;
};

export function getCachedDashboardData(
  clientId: string,
  clients: { client_id: string }[],
  prevFrom: string,
  rangeFrom: string,
  rangeTo: string
): Promise<DashboardData> {
  assertListed(clientId, clients);
  return unstable_cache(
    async (): Promise<DashboardData> => {
      const db = getAdminClient();
      const [metrics, total, repeat, retention, nvr] = await Promise.all([
        db
          .from("daily_report_metrics")
          .select("*")
          .eq("client_id", clientId)
          .gte("report_date", prevFrom)
          .lte("report_date", rangeTo)
          .order("report_date", { ascending: false }),
        db.from("customer_ltv").select("customer_id", { count: "exact", head: true }).eq("client_id", clientId),
        db.from("customer_ltv").select("customer_id", { count: "exact", head: true }).eq("client_id", clientId).gte("order_count", 2),
        db.from("cohort_retention").select("retention_rate").eq("client_id", clientId).eq("months_since_cohort", 1),
        db
          .from("daily_new_vs_returning")
          .select("new_customers, returning_customers")
          .eq("client_id", clientId)
          .gte("order_date", rangeFrom)
          .lte("order_date", rangeTo),
      ]);
      const failed = [metrics, total, repeat, retention, nvr].find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message); // errors are thrown, so they are never cached
      return {
        metrics: (metrics.data as Rows) ?? [],
        totalCustomers: total.count ?? 0,
        repeatCustomers: repeat.count ?? 0,
        retention: (retention.data as Rows) ?? [],
        newVsReturning: (nvr.data as Rows) ?? [],
      };
    },
    ["dashboard-v1", clientId, prevFrom, rangeFrom, rangeTo],
    { revalidate: TTL_SECONDS, tags: [`client-${clientId}`] }
  )();
}

export function getCachedReportRows(
  clientId: string,
  clients: { client_id: string }[],
  rangeFrom: string,
  rangeTo: string
): Promise<Rows> {
  assertListed(clientId, clients);
  return unstable_cache(
    async (): Promise<Rows> => {
      const { data, error } = await getAdminClient()
        .from("daily_report_metrics")
        .select("*")
        .eq("client_id", clientId)
        .gte("report_date", rangeFrom)
        .lte("report_date", rangeTo)
        .order("report_date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data as Rows) ?? [];
    },
    ["report-rows-v1", clientId, rangeFrom, rangeTo],
    { revalidate: TTL_SECONDS, tags: [`client-${clientId}`] }
  )();
}

// ---- Extra report formats (Reports page sections). Same access rule as above. ----

// Supabase returns at most 1,000 rows per request; read in pages until done.
async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Rows> {
  const out: Rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data as Rows) ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function getCachedOrderStats(clientId: string, clients: { client_id: string }[], from: string, to: string): Promise<Rows> {
  assertListed(clientId, clients);
  return unstable_cache(
    () =>
      fetchAll((a, b) =>
        getAdminClient()
          .from("daily_order_stats")
          .select("*")
          .eq("client_id", clientId)
          .gte("order_date", from)
          .lte("order_date", to)
          .order("order_date")
          .range(a, b)
      ),
    ["order-stats-v1", clientId, from, to],
    { revalidate: TTL_SECONDS, tags: [`client-${clientId}`] }
  )();
}

export function getCachedProductSales(clientId: string, clients: { client_id: string }[], from: string, to: string): Promise<Rows> {
  assertListed(clientId, clients);
  return unstable_cache(
    () =>
      fetchAll((a, b) =>
        getAdminClient()
          .from("daily_product_sales")
          .select("order_date, product_title, gross_sales")
          .eq("client_id", clientId)
          .gte("order_date", from)
          .lte("order_date", to)
          .order("order_date")
          .range(a, b)
      ),
    ["product-sales-v1", clientId, from, to],
    { revalidate: TTL_SECONDS, tags: [`client-${clientId}`] }
  )();
}

export function getCachedLandingPages(clientId: string, clients: { client_id: string }[], fromMonth: string): Promise<Rows> {
  assertListed(clientId, clients);
  return unstable_cache(
    () =>
      fetchAll((a, b) =>
        getAdminClient()
          .from("shopify_landing_page_sessions")
          .select("month, landing_page_path, sessions, sessions_with_cart_additions")
          .eq("client_id", clientId)
          .gte("month", fromMonth)
          .order("month")
          .range(a, b)
      ),
    ["landing-pages-v1", clientId, fromMonth],
    { revalidate: TTL_SECONDS, tags: [`client-${clientId}`] }
  )();
}

export function getCachedMonthlyMetrics(clientId: string, clients: { client_id: string }[], from: string, to: string): Promise<Rows> {
  assertListed(clientId, clients);
  return unstable_cache(
    () =>
      fetchAll((a, b) =>
        getAdminClient()
          .from("daily_report_metrics")
          .select("report_date, sessions, add_to_carts, order_count, gross_revenue")
          .eq("client_id", clientId)
          .gte("report_date", from)
          .lte("report_date", to)
          .order("report_date")
          .range(a, b)
      ),
    ["monthly-metrics-v1", clientId, from, to],
    { revalidate: TTL_SECONDS, tags: [`client-${clientId}`] }
  )();
}
