import { Download } from "lucide-react";
import { getSupabase, getClients, todayIn } from "@/lib/dashboardData";
import { resolveSelectedClient } from "@/lib/selectedClient";
import { ReportRow, computeTotal } from "@/lib/reportMath";
import { resolveReportColumns, attachDerivedColumns } from "@/lib/reportColumns";
import ReportDateControls from "../_components/ReportDateControls";
import MetricsCharts from "@/app/MetricsCharts";

const VIEWS = ["table", "chart"] as const;
type View = (typeof VIEWS)[number];

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

  // Default (no custom range): the store's current month so far -- every day
  // from the 1st up to today, oldest first, with a Total row. Days that
  // haven't happened yet simply have no row. A custom range replaces this.
  const today = todayIn(selected?.timezone);
  const monthStart = `${today.slice(0, 8)}01`;
  const isCustom = !!from;
  const isSingleDay = isCustom && (!to || to === from);
  const rangeFrom = isCustom ? from : monthStart;
  const rangeTo = isCustom ? (to || from) : today;

  const { data, error } = await supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", selectedClient)
    .gte("report_date", rangeFrom)
    .lte("report_date", rangeTo)
    .order("report_date", { ascending: true });

  const rows = attachDerivedColumns((data as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
  // Total row every day (month to date, or any range of more than one day).
  // computeTotal takes the latest day as rows[0] for MTD/LMTD, so it gets the
  // rows newest-first even though the table shows oldest-first.
  const showTotal = !isSingleDay && rows.length > 0;
  // The Total row is part of the PROAS colour scale, like in the Excel report.
  const totalRow = showTotal ? attachDerivedColumns([computeTotal([...rows].reverse())], reportConfig?.derivedColumns)[0] : null;
  const reportColumns = resolveReportColumns(reportConfig, totalRow ? [...rows, totalRow] : rows);

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
          <div data-tour="report-views" className="flex gap-1 rounded-full bg-zinc-900 p-1">
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
              href={`/api/reports/${selectedClient}${from ? `?from=${from}${to ? `&to=${to}` : ""}` : ""}`}
              data-tour="report-download"
              aria-label="Download Excel Report"
              title="Download Excel Report"
              className="flex items-center justify-center rounded-md border border-zinc-800 p-2 text-accent hover:bg-zinc-900"
            >
              <Download size={16} />
            </a>
          )}
        </div>
        <div data-tour="report-dates">
          <ReportDateControls />
        </div>
      </div>

      {error && <p className="rounded bg-status-bad/10 p-4 text-status-bad">Failed to load report: {error.message}</p>}
      {!error && rows.length === 0 && <p className="text-sm text-zinc-500">No data for this selection.</p>}

      {view === "chart" && !error && rows.length > 0 && <MetricsCharts data={rows} />}

      {view === "table" && !error && rows.length > 0 && (
        <div data-tour="report-table" className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
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

    </div>
  );
}
