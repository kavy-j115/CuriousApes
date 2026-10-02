import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("client_id, display_name, report_config").order("display_name");
  const selectedClient = await resolveSelectedClient(client, clients ?? []);
  const reportConfig = clients?.find((c) => c.client_id === selectedClient)?.report_config ?? null;
  const reportColumns = resolveReportColumns(reportConfig);

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

  const { data, error } = await query;
  const rows = attachDerivedColumns((data as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
  const showTotal = !isSingleDay && rows.length > 1;

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

      {error && <p className="rounded bg-red-950/60 p-4 text-red-300">Failed to load report: {error.message}</p>}
      {!error && rows.length === 0 && <p className="text-sm text-zinc-500">No data for this selection.</p>}

      {view === "chart" && !error && rows.length > 0 && <MetricsCharts data={[...rows].reverse()} />}

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
                    <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(row) ?? ""}`}>{c.fmt(row)}</td>
                  ))}
                </tr>
              ))}
              {showTotal && (() => {
                // Derived columns in the Total row are recomputed from the
                // already-totaled inputs (correct for ratio-style formulas
                // like a blended ROAS), not summed per-day -- same
                // "recompute, don't sum" choice the built-in ratio columns
                // (AOV, PROAS) already make in computeTotal().
                const total = attachDerivedColumns([computeTotal(rows)], reportConfig?.derivedColumns)[0];
                return (
                  <tr className="border-t-2 border-zinc-700 font-semibold text-zinc-100">
                    {reportColumns.map((c) => (
                      <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(total) ?? ""}`}>{c.fmt(total)}</td>
                    ))}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
