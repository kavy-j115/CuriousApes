import { createClient } from "@/lib/supabase/server";
import { ReportRow } from "@/lib/reportMath";
import { resolveReportColumns, attachDerivedColumns, type ReportConfig } from "@/lib/reportColumns";
import CompareDateControls from "../_components/CompareDateControls";
import CompareView from "@/app/CompareView";
import MetricsCharts from "@/app/MetricsCharts";

function ReportMiniTable({ rows, reportConfig }: { rows: ReportRow[]; reportConfig: ReportConfig }) {
  const columns = resolveReportColumns(reportConfig);
  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-2 py-1.5">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.report_date} className="border-b border-zinc-900 text-zinc-300">
                {columns.map((c) => (
                  <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(row) ?? ""}`}>{c.fmt(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ComparisonsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; aFrom?: string; aTo?: string; bFrom?: string; bTo?: string }>;
}) {
  const { client, aFrom, aTo, bFrom, bTo } = await searchParams;
  const hasStarted = !!(aFrom || aTo || bFrom || bTo);
  const hasPeriods = !!(aFrom && aTo && bFrom && bTo);

  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("client_id, display_name, report_config").order("display_name");
  const selectedClient = client ?? clients?.[0]?.client_id ?? "";
  const reportConfig: ReportConfig = clients?.find((c) => c.client_id === selectedClient)?.report_config ?? null;

  let rowsA: ReportRow[] = [];
  let rowsB: ReportRow[] = [];
  let compareError: string | null = null;

  if (hasPeriods) {
    const [resultA, resultB] = await Promise.all([
      supabase.from("daily_report_metrics").select("*").eq("client_id", selectedClient).gte("report_date", aFrom).lte("report_date", aTo).order("report_date"),
      supabase.from("daily_report_metrics").select("*").eq("client_id", selectedClient).gte("report_date", bFrom).lte("report_date", bTo).order("report_date"),
    ]);
    rowsA = attachDerivedColumns((resultA.data as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
    rowsB = attachDerivedColumns((resultB.data as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
    compareError = resultA.error?.message ?? resultB.error?.message ?? null;
  }

  if (!hasStarted) {
    return (
      <div>
        <h1 className="mb-2 text-xl font-semibold text-zinc-50">Comparisons</h1>
        <CompareDateControls />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-zinc-50">Comparisons</h1>
      <CompareDateControls />

      {!hasPeriods && <p className="text-sm text-zinc-500">Fill in both periods above.</p>}

      {hasPeriods && compareError && (
        <p className="rounded bg-red-950/60 p-4 text-red-300">Failed to load comparison: {compareError}</p>
      )}

      {hasPeriods && !compareError && (
        <div className="flex flex-col gap-8">
          <CompareView rowsA={rowsA} rowsB={rowsB} labelA={`${aFrom} – ${aTo}`} labelB={`${bFrom} – ${bTo}`} />

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-zinc-300">Period A</h3>
              {rowsA.length > 0 ? (
                <>
                  <MetricsCharts data={rowsA} />
                  <ReportMiniTable rows={rowsA} reportConfig={reportConfig} />
                </>
              ) : (
                <p className="text-sm text-zinc-500">No data.</p>
              )}
            </div>
            <div className="flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-zinc-300">Period B</h3>
              {rowsB.length > 0 ? (
                <>
                  <MetricsCharts data={rowsB} />
                  <ReportMiniTable rows={rowsB} reportConfig={reportConfig} />
                </>
              ) : (
                <p className="text-sm text-zinc-500">No data.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
