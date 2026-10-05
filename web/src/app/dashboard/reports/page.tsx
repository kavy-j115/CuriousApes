import { Download } from "lucide-react";
import { getSupabase, getClients, lastCompleteDay } from "@/lib/dashboardData";
import { getCachedReportRows } from "@/lib/cachedData";
import { resolveSelectedClient } from "@/lib/selectedClient";
import { ReportRow, computeTotal } from "@/lib/reportMath";
import { resolveReportColumns, attachDerivedColumns } from "@/lib/reportColumns";
import ReportDateControls from "../_components/ReportDateControls";
import MetricsCharts from "@/app/MetricsCharts";
import { getCachedLandingPages, getCachedMonthlyMetrics, getCachedOrderStats, getCachedProductSales } from "@/lib/cachedData";
import {
  type DailyMetricRow,
  type DailyOrderStats,
  type DailyProductSales,
  type LandingRow,
  landingPages,
  lastMonths,
  lastWeeks,
  monthlyHealth,
  ordersByWeek,
  productShare,
  rtoTable,
} from "@/lib/reportSections";
import { Empty, LandingPages, MonthlyHealth, OrdersSummary, ProductShare, RtoView } from "./SectionViews";

const SECTIONS = [
  { key: "daily", label: "Daily report" },
  { key: "orders", label: "Orders summary" },
  { key: "products", label: "Product share" },
  { key: "landing", label: "Landing pages" },
  { key: "monthly", label: "Monthly health" },
  { key: "rto", label: "RTO %" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const VIEWS = ["table", "chart"] as const;
type View = (typeof VIEWS)[number];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; from?: string; to?: string; view?: string; section?: string }>;
}) {
  const { client, from, to, view: viewParam, section: sectionParam } = await searchParams;
  const section: SectionKey = SECTIONS.some((x) => x.key === sectionParam) ? (sectionParam as SectionKey) : "daily";
  const view: View = VIEWS.includes(viewParam as View) ? (viewParam as View) : "table";

  const supabase = await getSupabase();
  const clients = await getClients();
  const selectedClient = await resolveSelectedClient(client, clients);
  const selected = clients.find((c) => c.client_id === selectedClient);
  const reportConfig = selected?.report_config ?? null;

  // Default (no custom range): the store's current month up to its last COMPLETE
  // day (yesterday) -- every day from the 1st, oldest first, with a Total row.
  // Today is left out until it is whole, so it appears tomorrow. A custom range
  // replaces this but is never allowed past the last complete day.
  const lastDay = lastCompleteDay(selected?.timezone);
  const monthStart = `${lastDay.slice(0, 8)}01`;
  const isCustom = !!from;
  const isSingleDay = isCustom && (!to || to === from);
  const rangeFrom = isCustom ? from : monthStart;
  const rawTo = isCustom ? (to || from) : lastDay;
  const rangeTo = rawTo > lastDay ? lastDay : rawTo;

  // What the table covers, said plainly -- on the 1st the default view is the
  // finished previous month, which must not look like the new (empty) month.
  const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const dayMonth = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const endsMonth = new Date(`${rangeTo}T00:00:00Z`).getUTCDate() === new Date(Date.UTC(Number(rangeTo.slice(0, 4)), Number(rangeTo.slice(5, 7)), 0)).getUTCDate();
  const periodLabel = isCustom
    ? rangeFrom === rangeTo
      ? dayMonth(rangeFrom)
      : `${dayMonth(rangeFrom)} – ${dayMonth(rangeTo)}`
    : endsMonth
      ? `${monthName(rangeTo)} · full month`
      : `${monthName(rangeTo)} · 1–${Number(rangeTo.slice(8, 10))} ${dayMonth(rangeTo).split(" ")[1]}`;

  const sectionHref = (k: SectionKey) => {
    const params = new URLSearchParams();
    if (selectedClient) params.set("client", selectedClient);
    if (k === "daily" || k === "rto") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    if (k !== "daily") params.set("section", k);
    return `/dashboard/reports?${params.toString()}`;
  };
  const tabs = (
    <div data-tour="report-sections" className="mb-5 flex flex-wrap gap-1 border-b border-zinc-900 pb-3">
      {SECTIONS.map((x) => (
        <a
          key={x.key}
          href={sectionHref(x.key)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${section === x.key ? "bg-accent/15 text-accent" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"}`}
        >
          {x.label}
        </a>
      ))}
    </div>
  );

  if (section !== "daily") {
    // Each section is read through the cache, only for a client in the user's own list.
    let body: React.ReactNode = <Empty>No client selected.</Empty>;
    if (selected) {
      try {
        if (section === "orders") {
          const weeks = lastWeeks(lastDay, 9);
          const rows = (await getCachedOrderStats(selectedClient, clients, weeks[weeks.length - 1].start, lastDay)) as unknown as DailyOrderStats[];
          body = <OrdersSummary weeks={ordersByWeek(rows, weeks)} />;
        } else if (section === "products") {
          const weeks = lastWeeks(lastDay, 9);
          const rows = (await getCachedProductSales(selectedClient, clients, weeks[weeks.length - 1].start, lastDay)) as unknown as DailyProductSales[];
          body = <ProductShare table={productShare(rows, weeks)} />;
        } else if (section === "landing") {
          const months = lastMonths(lastDay, 4);
          const rows = (await getCachedLandingPages(selectedClient, clients, months[months.length - 1].month)) as unknown as LandingRow[];
          body = <LandingPages table={landingPages(rows, months)} hasData={rows.length > 0} />;
        } else if (section === "monthly") {
          const months = lastMonths(lastDay, 12);
          const rows = (await getCachedMonthlyMetrics(selectedClient, clients, months[months.length - 1].month, lastDay)) as unknown as DailyMetricRow[];
          const m = monthlyHealth(rows, months);
          body = <MonthlyHealth rows={m.rows} total={m.total} />;
        } else {
          const rows = (await getCachedOrderStats(selectedClient, clients, rangeFrom, rangeTo)) as unknown as DailyOrderStats[];
          const t = rtoTable(rows);
          body = <RtoView days={t.days} total={t.total} name={selected.display_name ?? selectedClient} />;
        }
      } catch (e) {
        body = <p className="rounded bg-status-bad/10 p-4 text-status-bad">Failed to load this report: {e instanceof Error ? e.message : "unknown error"}</p>;
      }
    }
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-zinc-50">Reports</h1>
            {section === "rto" && (
              <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300">{periodLabel}</span>
            )}
          </div>
          {section === "rto" && <ReportDateControls />}
        </div>
        {tabs}
        {body}
      </div>
    );
  }

  // Cached for a few minutes (the data only changes with the daily sync). Only a client
  // from the user's own list is ever read this way -- see lib/cachedData.ts.
  let data: ReportRow[] = [];
  let error: { message: string } | null = null;
  if (selected) {
    try {
      data = (await getCachedReportRows(selectedClient, clients, rangeFrom, rangeTo)) as unknown as ReportRow[];
    } catch (e) {
      error = { message: e instanceof Error ? e.message : "Couldn't load the report." };
    }
  }

  const rows = attachDerivedColumns(data, reportConfig?.derivedColumns);
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
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs font-medium text-zinc-300" data-tour="report-period">
            {periodLabel}
          </span>
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

      {tabs}

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
