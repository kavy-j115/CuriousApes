import Link from "next/link";
import { supabase } from "@/lib/supabase";
import ReportControls from "./ReportControls";
import MetricsCharts from "./MetricsCharts";

type ReportRow = {
  client_id: string;
  report_date: string;
  sessions: number | null;
  add_to_carts: number | null;
  order_count: number;
  gross_revenue: string;
  aov: string;
  amount_spent: string | null;
  purchase_value: string | null;
  proas: string | null;
  atc_pct: string | null;
  conversion_pct: string | null;
  checkout_pct: string | null;
  mtd_sale: string;
  lmtd_sale: string | null;
};

function fmtNum(v: number | string | null): string {
  if (v === null || v === undefined) return "—";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPct(v: string | null): string {
  if (v === null) return "—";
  return `${(Number(v) * 100).toFixed(1)}%`;
}

const REPORT_COLUMNS: { label: string; key: keyof ReportRow; fmt: (r: ReportRow) => string }[] = [
  { label: "Day", key: "report_date", fmt: (r) => r.report_date },
  { label: "Sessions", key: "sessions", fmt: (r) => fmtNum(r.sessions) },
  { label: "Cart Adds", key: "add_to_carts", fmt: (r) => fmtNum(r.add_to_carts) },
  { label: "Orders", key: "order_count", fmt: (r) => fmtNum(r.order_count) },
  { label: "Gross Sales", key: "gross_revenue", fmt: (r) => fmtNum(r.gross_revenue) },
  { label: "AOV", key: "aov", fmt: (r) => fmtNum(r.aov) },
  { label: "Ad Spend", key: "amount_spent", fmt: (r) => fmtNum(r.amount_spent) },
  { label: "Purchase Value", key: "purchase_value", fmt: (r) => fmtNum(r.purchase_value) },
  { label: "PROAS", key: "proas", fmt: (r) => fmtNum(r.proas) },
  { label: "ATC %", key: "atc_pct", fmt: (r) => fmtPct(r.atc_pct) },
  { label: "Conv %", key: "conversion_pct", fmt: (r) => fmtPct(r.conversion_pct) },
  { label: "Checkout %", key: "checkout_pct", fmt: (r) => fmtPct(r.checkout_pct) },
  { label: "MTD Sale", key: "mtd_sale", fmt: (r) => fmtNum(r.mtd_sale) },
  { label: "LMTD", key: "lmtd_sale", fmt: (r) => fmtNum(r.lmtd_sale) },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; date?: string; tab?: string }>;
}) {
  const { client, date, tab: tabParam } = await searchParams;
  const tab = tabParam === "viz" ? "viz" : "report";

  const { data: clients } = await supabase
    .from("clients")
    .select("client_id, display_name")
    .order("display_name");

  const selectedClient = client ?? clients?.[0]?.client_id ?? "";
  const selectedDate = date ?? "";

  let query = supabase
    .from("daily_report_metrics")
    .select("*")
    .eq("client_id", selectedClient)
    .order("report_date", { ascending: false });

  query = selectedDate ? query.eq("report_date", selectedDate) : query.limit(28);

  const { data, error } = await query;
  const rows = (data as ReportRow[] | null) ?? [];

  return (
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
      <main className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              D2C Analytics
            </h1>
            <div className="flex gap-1 rounded-full bg-zinc-200 p-1 dark:bg-zinc-800">
              {(["report", "viz"] as const).map((t) => (
                <Link
                  key={t}
                  href={`/?tab=${t}${selectedClient ? `&client=${selectedClient}` : ""}${selectedDate ? `&date=${selectedDate}` : ""}`}
                  className={`rounded-full px-4 py-1 text-sm font-medium transition-colors ${
                    tab === t
                      ? "bg-white text-black shadow dark:bg-zinc-950 dark:text-zinc-50"
                      : "text-zinc-600 dark:text-zinc-400"
                  }`}
                >
                  {t === "report" ? "Report" : "Visualizations"}
                </Link>
              ))}
            </div>
          </div>
          <ReportControls
            clients={clients ?? []}
            selectedClient={selectedClient}
            selectedDate={selectedDate}
            tab={tab}
          />
        </div>

        {error && (
          <p className="rounded bg-red-100 p-4 text-red-800">
            Failed to load report: {error.message}
          </p>
        )}

        {!error && rows.length === 0 && (
          <p className="text-zinc-600 dark:text-zinc-400">No data for this selection.</p>
        )}

        {!error && rows.length > 0 && tab === "viz" && <MetricsCharts data={rows} />}

        {!error && rows.length > 0 && tab === "report" && (
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
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
