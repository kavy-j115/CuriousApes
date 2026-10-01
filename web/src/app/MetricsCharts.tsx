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
      <div>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">
          Gross Revenue
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.4} />
            <XAxis dataKey="date" fontSize={11} stroke="#71717a" />
            <YAxis fontSize={11} stroke="#71717a" />
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
            <Line type="monotone" dataKey="revenue" stroke="#a3e635" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium text-zinc-400">
          Orders
        </h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.4} />
            <XAxis dataKey="date" fontSize={11} stroke="#71717a" />
            <YAxis fontSize={11} allowDecimals={false} stroke="#71717a" />
            <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", fontSize: 12 }} />
            <Bar dataKey="orders" fill="#38bdf8" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
