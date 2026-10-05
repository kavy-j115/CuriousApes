import { DollarSign, Users, ShoppingCart, Receipt, Repeat, UserPlus, UserCheck, TrendingUp } from "lucide-react";
import { getClients, lastCompleteDay, shiftDate } from "@/lib/dashboardData";
import { getCachedDashboardData } from "@/lib/cachedData";
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
  const clients = await getClients();

  const selectedClient = await resolveSelectedClient(client, clients ?? []);
  const selected = clients?.find((c) => c.client_id === selectedClient);

  if (!selectedClient) {
    return <p className="text-sm text-zinc-500">No client assigned to your account yet.</p>;
  }

  // The range shown: the one picked in the date controls, otherwise the store's
  // last 30 COMPLETE days (ending yesterday in its own time zone -- today is left
  // out until it is whole). The comparison period is the same number of days
  // immediately before it.
  const lastDay = lastCompleteDay(selected?.timezone);
  const hasRange = !!from && DATE_RE.test(from);
  const pickedTo = hasRange ? (to && DATE_RE.test(to) && to >= from ? to : from) : lastDay;
  const rangeTo = pickedTo > lastDay ? lastDay : pickedTo;
  const rangeFrom = hasRange ? (from > rangeTo ? rangeTo : from) : shiftDate(lastDay, -29);
  const length = daysBetween(rangeFrom, rangeTo);
  const prevTo = shiftDate(rangeFrom, -1);
  const prevFrom = shiftDate(prevTo, -(length - 1));

  // One parallel batch: every query only needs selectedClient, so none
  // should wait on another (each is a separate trip to the database).
  // Cached for a few minutes (the data only changes with the daily sync); only a client
  // from the user's own list is ever read this way -- see lib/cachedData.ts.
  if (!selected) return <p className="text-sm text-zinc-500">No data for this client.</p>;
  const dash = await getCachedDashboardData(selectedClient, clients, prevFrom, rangeFrom, rangeTo);
  const data = dash.metrics;
  const totalCustomerCount = dash.totalCustomers;
  const repeatCustomerCount = dash.repeatCustomers;
  const retentionRows = dash.retention as { retention_rate: number | string }[];
  const newVsReturningRows = dash.newVsReturning as { new_customers: number; returning_customers: number }[];

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
