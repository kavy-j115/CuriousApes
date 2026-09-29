import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { ReportRow, REPORT_COLUMNS, computeTotal } from "@/lib/reportMath";
import ReportControls from "./ReportControls";
import CompareControls from "./CompareControls";
import MetricsCharts from "./MetricsCharts";
import CompareView from "./CompareView";

const TABS = ["report", "viz", "compare"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { report: "Report", viz: "Visualizations", compare: "Compare" };

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    from?: string;
    to?: string;
    aFrom?: string;
    aTo?: string;
    bFrom?: string;
    bTo?: string;
    tab?: string;
  }>;
}) {
  const { client, from, to, aFrom, aTo, bFrom, bTo, tab: tabParam } = await searchParams;
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "report";

  const { data: clients } = await supabase
    .from("clients")
    .select("client_id, display_name")
    .order("display_name");

  const selectedClient = client ?? clients?.[0]?.client_id ?? "";
  const selectedFrom = from ?? "";
  const selectedTo = to ?? "";

  const isSingleDay = !!selectedFrom && (!selectedTo || selectedTo === selectedFrom);
  const isRange = !!selectedFrom && !!selectedTo && selectedTo !== selectedFrom;

  let query = supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", selectedClient)
    .order("report_date", { ascending: false });

  if (isSingleDay) {
    query = query.eq("report_date", selectedFrom);
  } else if (isRange) {
    query = query.gte("report_date", selectedFrom).lte("report_date", selectedTo);
  } else {
    query = query.limit(28);
  }

  const { data, error } = tab === "compare" ? { data: null, error: null } : await query;
  const rows = (data as ReportRow[] | null) ?? [];
  const showTotal = !isSingleDay && rows.length > 1;

  // Compare tab: two independent ranges, fetched only when both are set.
  const selectedAFrom = aFrom ?? "";
  const selectedATo = aTo ?? "";
  const selectedBFrom = bFrom ?? "";
  const selectedBTo = bTo ?? "";
  const hasComparePeriods = !!(selectedAFrom && selectedATo && selectedBFrom && selectedBTo);

  let rowsA: ReportRow[] = [];
  let rowsB: ReportRow[] = [];
  let compareError: string | null = null;

  if (tab === "compare" && hasComparePeriods) {
    const [resultA, resultB] = await Promise.all([
      supabase
        .from("daily_report_metrics")
        .select("*")
        .eq("client_id", selectedClient)
        .gte("report_date", selectedAFrom)
        .lte("report_date", selectedATo),
      supabase
        .from("daily_report_metrics")
        .select("*")
        .eq("client_id", selectedClient)
        .gte("report_date", selectedBFrom)
        .lte("report_date", selectedBTo),
    ]);
    rowsA = (resultA.data as ReportRow[] | null) ?? [];
    rowsB = (resultB.data as ReportRow[] | null) ?? [];
    compareError = resultA.error?.message ?? resultB.error?.message ?? null;
  }

  const tabHref = (t: string) =>
    `/?tab=${t}${selectedClient ? `&client=${selectedClient}` : ""}${selectedFrom ? `&from=${selectedFrom}` : ""}${selectedTo ? `&to=${selectedTo}` : ""}`;

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
      <main className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              D2C Analytics
            </h1>
            <div className="flex gap-1 rounded-full bg-zinc-200 p-1 dark:bg-zinc-800">
              {TABS.map((t) => (
                <Link
                  key={t}
                  href={tabHref(t)}
                  className={`rounded-full px-4 py-1 text-sm font-medium transition-colors ${
                    tab === t
                      ? "bg-white text-black shadow dark:bg-zinc-950 dark:text-zinc-50"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {TAB_LABELS[t]}
                </Link>
              ))}
            </div>
            <Link href="/segments" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
              Segment Export →
            </Link>
          </div>
          {tab !== "compare" && (
            <ReportControls
              clients={clients ?? []}
              selectedClient={selectedClient}
              selectedFrom={selectedFrom}
              selectedTo={selectedTo}
              tab={tab}
            />
          )}
          {tab === "compare" && (
            <CompareControls
              clients={clients ?? []}
              selectedClient={selectedClient}
              aFrom={selectedAFrom}
              aTo={selectedATo}
              bFrom={selectedBFrom}
              bTo={selectedBTo}
            />
          )}
        </div>

        {tab !== "compare" && error && (
          <p className="rounded bg-red-100 p-4 text-red-800">
            Failed to load report: {error.message}
          </p>
        )}

        {tab !== "compare" && !error && rows.length === 0 && (
          <p className="text-zinc-600 dark:text-zinc-400">No data for this selection.</p>
        )}

        {tab === "viz" && !error && rows.length > 0 && <MetricsCharts data={rows} />}

        {tab === "report" && !error && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-300 bg-[#4472C4] text-left text-white dark:border-zinc-700">
                  {REPORT_COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-2 py-2">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.report_date} className="border-b border-zinc-200 dark:border-zinc-800">
                    {REPORT_COLUMNS.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-2 py-1">{c.fmt(row)}</td>
                    ))}
                  </tr>
                ))}
                {showTotal && (
                  <tr className="border-t-2 border-zinc-400 font-semibold dark:border-zinc-600">
                    {REPORT_COLUMNS.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-2 py-1">
                        {c.fmt(computeTotal(rows))}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "compare" && (
          <>
            {compareError && (
              <p className="rounded bg-red-100 p-4 text-red-800">Failed to load comparison: {compareError}</p>
            )}
            {!compareError && !hasComparePeriods && (
              <p className="text-zinc-600 dark:text-zinc-400">
                Pick both Period A and Period B date ranges above to compare them.
              </p>
            )}
            {!compareError && hasComparePeriods && (
              <CompareView
                rowsA={rowsA}
                rowsB={rowsB}
                labelA={`${selectedAFrom} – ${selectedATo}`}
                labelB={`${selectedBFrom} – ${selectedBTo}`}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
