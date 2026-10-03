import { DollarSign, Users, ShoppingCart, Receipt, Repeat, UserPlus, UserCheck, TrendingUp } from "lucide-react";
import { getSupabase, getClients, todayIn, shiftDate } from "@/lib/dashboardData";
import { resolveSelectedClient } from "@/lib/selectedClient";
import { computeTotal, ReportRow, fmtNum } from "@/lib/reportMath";
import { attachDerivedColumns } from "@/lib/reportColumns";
import StatTile from "./_components/StatTile";
import ReportDateControls from "./_components/ReportDateControls";
import MetricsCharts from "@/app/MetricsCharts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000) + 1;
}

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; from?: string; to?: string }>;
}) {
  const { client, from, to } = await searchParams;
  const supabase = await getSupabase();
  const clients = await getClients();

  const selectedClient = await resolveSelectedClient(client, clients ?? []);
  const selected = clients?.find((c) => c.client_id === selectedClient);

  if (!selectedClient) {
    return <p className="text-sm text-zinc-500">No client assigned to your account yet.</p>;
  }

  // The range shown: the one picked in the date controls, otherwise the store's
  // last 30 days (its own "today", not UTC's). The comparison period is the
  // same number of days immediately before it.
  const today = todayIn(selected?.timezone);
  const hasRange = !!from && DATE_RE.test(from);
  const rangeTo = hasRange ? (to && DATE_RE.test(to) && to >= from ? to : from) : today;
  const rangeFrom = hasRange ? from : shiftDate(today, -29);
  const length = daysBetween(rangeFrom, rangeTo);
  const prevTo = shiftDate(rangeFrom, -1);
  const prevFrom = shiftDate(prevTo, -(length - 1));

  // One parallel batch: every query only needs selectedClient, so none
  // should wait on another (each is a separate trip to the database).
  const [
    { data },
    { count: totalCustomerCount },
    { count: repeatCustomerCount },
    { data: retentionRows },
    { data: newVsReturningRows },
  ] = await Promise.all([
    supabase
      .from("daily_report_metrics")
      .select("*")
      .eq("client_id", selectedClient)
      .gte("report_date", prevFrom)
      .lte("report_date", rangeTo)
      .order("report_date", { ascending: false }),
    // Counted by the database (head: true returns no rows) -- fetching rows
    // and taking .length silently capped at Supabase's 1,000-row limit.
    supabase.from("customer_ltv").select("customer_id", { count: "exact", head: true }).eq("client_id", selectedClient),
    supabase.from("customer_ltv").select("customer_id", { count: "exact", head: true }).eq("client_id", selectedClient).gte("order_count", 2),
    supabase.from("cohort_retention").select("retention_rate").eq("client_id", selectedClient).eq("months_since_cohort", 1),
    supabase
      .from("daily_new_vs_returning")
      .select("new_customers, returning_customers")
      .eq("client_id", selectedClient)
      .gte("order_date", rangeFrom)
      .lte("order_date", rangeTo),
  ]);

  const rows = attachDerivedColumns((data as ReportRow[] | null) ?? [], selected?.report_config?.derivedColumns);
  const currentRows = rows.filter((r) => r.report_date >= rangeFrom);
  const previousRows = rows.filter((r) => r.report_date < rangeFrom);

  const current = computeTotal(currentRows);
  const previous = computeTotal(previousRows);

  const totalCustomers = totalCustomerCount ?? 0;
  const repeatCustomers = repeatCustomerCount ?? 0;
  const avgRetention =
    retentionRows && retentionRows.length > 0
      ? retentionRows.reduce((acc, r) => acc + Number(r.retention_rate), 0) / retentionRows.length
      : null;
  const newCustomers = (newVsReturningRows ?? []).reduce((acc, r) => acc + (r.new_customers as number), 0);
  const returningCustomers = (newVsReturningRows ?? []).reduce((acc, r) => acc + (r.returning_customers as number), 0);

  const revenue = Number(current.gross_revenue);
  const prevRevenue = Number(previous.gross_revenue);
  const aov = Number(current.aov);
  const prevAov = Number(previous.aov);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-xl font-semibold text-zinc-50">Dashboard</h1>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <p className="text-xs text-zinc-400">
            <span className="font-medium text-zinc-200">{selected?.display_name ?? selectedClient}</span>
            {" · "}
            {rangeFrom === rangeTo ? fmtDay(rangeFrom) : `${fmtDay(rangeFrom)} – ${fmtDay(rangeTo)}`}
            {" · "}
            {length} {length === 1 ? "day" : "days"}
          </p>
          <div data-tour="dash-dates">
            <ReportDateControls defaultRange="30d" />
          </div>
        </div>
      </div>

      <div data-tour="dash-tiles" className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile icon={DollarSign} label="Gross Sales" value={fmtNum(revenue)} deltaPct={pctChange(revenue, prevRevenue)} />
        <StatTile icon={Users} label="Customers" value={fmtNum(totalCustomers)} deltaPct={null} />
        <StatTile
          icon={ShoppingCart}
          label="Orders"
          value={fmtNum(current.order_count)}
          deltaPct={pctChange(current.order_count, previous.order_count)}
        />
        <StatTile icon={Receipt} label="AOV" value={fmtNum(aov)} deltaPct={pctChange(aov, prevAov)} />
        <StatTile
          icon={TrendingUp}
          label="Retention Rate"
          value={avgRetention !== null ? `${(avgRetention * 100).toFixed(1)}%` : "—"}
          deltaPct={null}
        />
        <StatTile icon={Repeat} label="Repeat Customers" value={fmtNum(repeatCustomers)} deltaPct={null} />
        <StatTile icon={UserPlus} label="New Customers" value={fmtNum(newCustomers)} deltaPct={null} />
        <StatTile icon={UserCheck} label="Returning Customers" value={fmtNum(returningCustomers)} deltaPct={null} />
      </div>

      {currentRows.length > 0 ? (
        <div data-tour="dash-charts">
          <MetricsCharts data={[...currentRows].reverse()} />
        </div>
      ) : (
        <p className="text-sm text-zinc-500">No data in this range for this client.</p>
      )}
    </div>
  );
}
