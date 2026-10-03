import { Download } from "lucide-react";
import { getSupabase, getClients, todayIn, shiftDate } from "@/lib/dashboardData";
import { resolveSelectedClient } from "@/lib/selectedClient";
import { ReportRow, computeTotal } from "@/lib/reportMath";
import { resolveReportColumns, attachDerivedColumns, type ColumnDef } from "@/lib/reportColumns";
import ReportDateControls from "../_components/ReportDateControls";
import MetricsCharts from "@/app/MetricsCharts";

const VIEWS = ["table", "chart"] as const;
type View = (typeof VIEWS)[number];

function SummaryTable({ columns, rows }: { columns: ColumnDef[]; rows: ReportRow[] }) {
  return (
    <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
            {columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.report_date} className="border-b border-zinc-900 text-zinc-300">
              {columns.map((c) => (
                <td key={c.key} style={c.cellStyle?.(row)} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(row) ?? ""}`}>{c.fmt(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; from?: string; to?: string; view?: string }>;
}) {
  const { client, from, to, view: viewParam } = await searchParams;
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "table";

  const supabase = await getSupabase();
  const clients = await getClients();
  const selectedClient = await resolveSelectedClient(client, clients);
  const selected = clients.find((c) => c.client_id === selectedClient);
  const reportConfig = selected?.report_config ?? null;

  const isSingleDay = !!from && (!to || to === from);
  const isRange = !!from && !!to && to !== from;

  let query = supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", selectedClient)
    .order("report_date", { ascending: false });

  if (isSingleDay) query = query.eq("report_date", from);
  else if (isRange) query = query.gte("report_date", from).lte("report_date", to);
  else query = query.limit(28);

  // The summary always covers the store's last 7 and 30 days, whatever range
  // is shown above, so it's fetched alongside rather than derived from it.
  const today = todayIn(selected?.timezone);
  const since30 = shiftDate(today, -29);
  const since7 = shiftDate(today, -6);
  const [{ data, error }, { data: summaryData }] = await Promise.all([
    query,
    supabase
      .from("daily_report_metrics")
      .select("*")
      .eq("client_id", selectedClient)
      .gte("report_date", since30)
      .order("report_date", { ascending: false }),
  ]);

  const rows = attachDerivedColumns((data as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
  const showTotal = !isSingleDay && rows.length > 1;
  // The Total row is part of the PROAS colour scale, like in the Excel report.
  const totalRow = showTotal ? attachDerivedColumns([computeTotal(rows)], reportConfig?.derivedColumns)[0] : null;
  const reportColumns = resolveReportColumns(reportConfig, totalRow ? [...rows, totalRow] : rows);

  const rows30 = attachDerivedColumns((summaryData as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
  const rows7 = rows30.filter((r) => r.report_date >= since7);
  const summaryRow = (list: ReportRow[], label: string): ReportRow => ({
    ...attachDerivedColumns([computeTotal(list)], reportConfig?.derivedColumns)[0],
    report_date: label,
  });
  const summaries = [
    ...(rows7.length > 0 ? [summaryRow(rows7, "Last 7 days")] : []),
    ...(rows30.length > 0 ? [summaryRow(rows30, "Last 30 days")] : []),
  ];

  const summaryColumns = resolveReportColumns(reportConfig, summaries);

  const viewHref = (v: View) => {
    const params = new URLSearchParams();
    if (selectedClient) params.set("client", selectedClient);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("view", v);
    return `/dashboard/reports?${params.toString()}`;
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-zinc-50">Reports</h1>
          <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
            {VIEWS.map((v) => (
              <a
                key={v}
                href={viewHref(v)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  view === v ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"
                }`}
              >
                {v}
              </a>
            ))}
          </div>
          {selectedClient && (
            <a
              href={`/api/reports/${selectedClient}`}
              aria-label="Download Excel Report"
              title="Download Excel Report"
              className="flex items-center justify-center rounded-md border border-zinc-800 p-2 text-accent hover:bg-zinc-900"
            >
              <Download size={16} />
            </a>
          )}
        </div>
        <ReportDateControls />
      </div>

      {error && <p className="rounded bg-status-bad/10 p-4 text-status-bad">Failed to load report: {error.message}</p>}
      {!error && rows.length === 0 && <p className="text-sm text-zinc-500">No data for this selection.</p>}

      {view === "chart" && !error && rows.length > 0 && <MetricsCharts data={rows} />}

      {view === "table" && !error && rows.length > 0 && (
        <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
                {reportColumns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.report_date} className="border-b border-zinc-900 text-zinc-300">
                  {reportColumns.map((c) => (
                    <td key={c.key} style={c.cellStyle?.(row)} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(row) ?? ""}`}>{c.fmt(row)}</td>
                  ))}
                </tr>
              ))}
              {totalRow && (
                // Derived columns in the Total row are recomputed from the
                // already-totaled inputs (correct for ratio-style formulas),
                // not summed per day -- same choice computeTotal() makes for
                // AOV and PROAS.
                <tr className="border-t-2 border-zinc-700 font-semibold text-zinc-100">
                  {reportColumns.map((c) => (
                    <td key={c.key} style={c.cellStyle?.(totalRow)} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(totalRow) ?? ""}`}>{c.fmt(totalRow)}</td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!error && summaries.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-4">
            <h2 className="text-base font-semibold text-zinc-50">Summary</h2>
            {selectedClient && (
              <div className="flex items-center gap-3 text-xs">
                {(["weekly", "monthly"] as const).map((type) => (
                  <a
                    key={type}
                    href={`/api/reports/${selectedClient}?type=${type}`}
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <Download size={12} />
                    {type === "weekly" ? "7-day" : "30-day"} Excel
                  </a>
                ))}
              </div>
            )}
          </div>
          <SummaryTable columns={summaryColumns} rows={summaries} />
        </div>
      )}
    </div>
  );
}
