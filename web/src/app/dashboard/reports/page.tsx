import { Download } from "lucide-react";
import { getSupabase, getClients, todayIn, shiftDate } from "@/lib/dashboardData";
import { resolveSelectedClient } from "@/lib/selectedClient";
import { ReportRow, computeTotal } from "@/lib/reportMath";
import { resolveReportColumns, attachDerivedColumns, type ColumnDef } from "@/lib/reportColumns";
import MetricsCharts from "@/app/MetricsCharts";

const VIEWS = ["table", "chart"] as const;
type View = (typeof VIEWS)[number];

const DOWNLOADS = [
  { type: "daily", label: "Daily" },
  { type: "weekly", label: "Weekly" },
  { type: "monthly", label: "Monthly" },
] as const;

function ReportTable({ columns, rows }: { columns: ColumnDef[]; rows: ReportRow[] }) {
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
                <td key={c.key} className={`whitespace-nowrap px-2 py-1 ${c.cellClassName?.(row) ?? ""}`}>{c.fmt(row)}</td>
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
  searchParams: Promise<{ client?: string; view?: string }>;
}) {
  const { client, view: viewParam } = await searchParams;
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "table";

  const supabase = await getSupabase();
  const clients = await getClients();
  const selectedClient = await resolveSelectedClient(client, clients);
  const selected = clients.find((c) => c.client_id === selectedClient);
  const reportConfig = selected?.report_config ?? null;
  const reportColumns = resolveReportColumns(reportConfig);

  // Day by day only for the last 7 days; everything older is folded into the
  // 7-day and 30-day summaries below it. Dates are the store's own days.
  const today = todayIn(selected?.timezone);
  const since7 = shiftDate(today, -6);
  const since30 = shiftDate(today, -29);

  const { data, error } = await supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", selectedClient)
    .gte("report_date", since30)
    .order("report_date", { ascending: false });

  const rows30 = attachDerivedColumns((data as ReportRow[] | null) ?? [], reportConfig?.derivedColumns);
  const rows7 = rows30.filter((r) => r.report_date >= since7);

  // A summary row is the same weighted total the Excel report's Total row
  // uses; derived columns are recomputed from the totals, not summed.
  const summaryRow = (rows: ReportRow[], label: string): ReportRow => ({
    ...attachDerivedColumns([computeTotal(rows)], reportConfig?.derivedColumns)[0],
    report_date: label,
  });
  const summaries = [
    ...(rows7.length > 0 ? [summaryRow(rows7, "Last 7 days")] : []),
    ...(rows30.length > 0 ? [summaryRow(rows30, "Last 30 days")] : []),
  ];

  const viewHref = (v: View) => `/dashboard/reports?${new URLSearchParams({ ...(selectedClient ? { client: selectedClient } : {}), view: v })}`;

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
        </div>
        {selectedClient && (
          <div className="flex items-center gap-2">
            {DOWNLOADS.map((d) => (
              <a
                key={d.type}
                href={`/api/reports/${selectedClient}?type=${d.type}`}
                title={`Download ${d.label.toLowerCase()} Excel report`}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:border-accent hover:text-accent"
              >
                <Download size={13} />
                {d.label}
              </a>
            ))}
          </div>
        )}
      </div>

      {error && <p className="rounded bg-status-bad/10 p-4 text-status-bad">Failed to load report: {error.message}</p>}
      {!error && rows30.length === 0 && <p className="text-sm text-zinc-500">No data for this client yet.</p>}

      {!error && rows7.length > 0 && view === "chart" && <MetricsCharts data={rows7} />}
      {!error && rows7.length > 0 && view === "table" && <ReportTable columns={reportColumns} rows={rows7} />}

      {!error && summaries.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-zinc-50">Summary</h2>
          <ReportTable columns={reportColumns} rows={summaries} />
        </div>
      )}
    </div>
  );
}
