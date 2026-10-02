"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type ChartRow = {
  report_date: string;
  gross_revenue: string;
  order_count: number;
};

// Colors validated as a categorical pair against this app's dark surface --
// see the comment in globals.css next to --accent/--chart-2. Single series
// per chart, so no legend needed (the heading above each chart names it).
const REVENUE_COLOR = "var(--accent)";
const ORDERS_COLOR = "var(--chart-2)";

const AXIS_PROPS = { fontSize: 11, stroke: "#52525b", tickLine: false, axisLine: { stroke: "#27272a" } };
const TOOLTIP_STYLE = { background: "#18181b", border: "1px solid #27272a", borderRadius: 8, fontSize: 12 };

export default function MetricsCharts({ data }: { data: ChartRow[] }) {
  // Charts read oldest -> newest, left to right; the report table stays
  // newest-first since that's more useful for a quick daily check.
  const chartData = [...data]
    .reverse()
    .map((row) => ({
      date: row.report_date,
      revenue: Number(row.gross_revenue),
      orders: row.order_count,
    }));

  return (
    <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
      <div className="rounded-xl border border-zinc-900 bg-gradient-to-b from-zinc-950 to-black p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Gross Revenue</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="date" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#a1a1aa" }} cursor={{ stroke: "#3f3f46" }} />
            <Line type="monotone" dataKey="revenue" stroke={REVENUE_COLOR} strokeWidth={2} dot={{ r: 4, fill: REVENUE_COLOR, strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-zinc-900 bg-gradient-to-b from-zinc-950 to-black p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Orders</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="date" {...AXIS_PROPS} />
            <YAxis allowDecimals={false} {...AXIS_PROPS} />
            <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "#a1a1aa" }} cursor={{ fill: "#27272a", opacity: 0.4 }} />
            <Bar dataKey="orders" fill={ORDERS_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
