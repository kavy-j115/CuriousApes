import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { computeTotal, ReportRow, fmtNum } from "@/lib/reportMath";
import { resolveReportColumns } from "@/lib/reportColumns";
import StatTile from "./_components/StatTile";
import MetricsCharts from "@/app/MetricsCharts";

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function pctChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export default async function DashboardHomePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client } = await searchParams;
  const supabase = await createClient();

  const { data: clients } = await supabase
    .from("clients")
    .select("client_id, display_name, report_config")
    .order("display_name");

  const selectedClient = client ?? clients?.[0]?.client_id ?? "";
  const reportColumns = resolveReportColumns(
    clients?.find((c) => c.client_id === selectedClient)?.report_config ?? null
  );

  if (!selectedClient) {
    return <p className="text-sm text-zinc-500">No client assigned to your account yet.</p>;
  }

  const since60 = isoDaysAgo(60);
  const { data } = await supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", selectedClient)
    .gte("report_date", since60)
    .order("report_date", { ascending: false });

  const rows = (data as ReportRow[] | null) ?? [];
  const since30 = isoDaysAgo(30);
  const currentRows = rows.filter((r) => r.report_date >= since30);
  const previousRows = rows.filter((r) => r.report_date < since30);

  const current = computeTotal(currentRows);
  const previous = computeTotal(previousRows);

  const [{ data: ltvRows }, { data: retentionRows }] = await Promise.all([
    supabase.from("customer_ltv").select("customer_id, order_count").eq("client_id", selectedClient),
    supabase
      .from("cohort_retention")
      .select("retention_rate")
      .eq("client_id", selectedClient)
      .eq("months_since_cohort", 1),
  ]);

  const totalCustomers = ltvRows?.length ?? 0;
  const repeatCustomers = ltvRows?.filter((r) => (r.order_count as number) >= 2).length ?? 0;
  const avgRetention =
    retentionRows && retentionRows.length > 0
      ? retentionRows.reduce((acc, r) => acc + Number(r.retention_rate), 0) / retentionRows.length
      : null;

  const revenue = Number(current.gross_revenue);
  const prevRevenue = Number(previous.gross_revenue);
  const aov = Number(current.aov);
  const prevAov = Number(previous.aov);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-50">Dashboard</h1>
        <p className="text-sm text-zinc-500">Here&apos;s an overview of your brand&apos;s performance.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Revenue" value={fmtNum(revenue)} deltaPct={pctChange(revenue, prevRevenue)} />
        <StatTile
          label="Customers"
          value={fmtNum(totalCustomers)}
          deltaPct={null}
        />
        <StatTile
          label="Orders"
          value={fmtNum(current.order_count)}
          deltaPct={pctChange(current.order_count, previous.order_count)}
        />
        <StatTile label="AOV" value={fmtNum(aov)} deltaPct={pctChange(aov, prevAov)} />
        <StatTile
          label="Retention Rate"
          value={avgRetention !== null ? `${(avgRetention * 100).toFixed(1)}%` : "—"}
          deltaPct={null}
        />
        <StatTile label="Repeat Customers" value={fmtNum(repeatCustomers)} deltaPct={null} />
      </div>

      {currentRows.length > 0 ? (
        <MetricsCharts data={[...currentRows].reverse()} />
      ) : (
        <p className="text-sm text-zinc-500">No data in the last 30 days for this client.</p>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-50">Daily Reports</h2>
          <Link
            href={`/dashboard/reports${selectedClient ? `?client=${selectedClient}` : ""}`}
            className="text-sm text-sky-400 hover:underline"
          >
            View full reports →
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">No daily reports yet for this client.</p>
        ) : (
          <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
                  {reportColumns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 10).map((row) => (
                  <tr key={row.report_date} className="border-b border-zinc-900 text-zinc-300">
                    {reportColumns.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(row) ?? ""}`}>{c.fmt(row)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
