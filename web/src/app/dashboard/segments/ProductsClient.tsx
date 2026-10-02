"use client";

import { useState, useMemo } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import { parseExport, looksLikeOrdersExport, looksLikeCustomersExport } from "@/lib/segmentRecipes";
import { aggregateProductStats, type ProductStats } from "@/lib/productAnalytics";

type SortKey = "unitsSold" | "orderCount" | "revenue";

const SORT_LABELS: Record<SortKey, string> = {
  unitsSold: "Most sold",
  orderCount: "Most orders",
  revenue: "Highest revenue",
};

export default function ProductsClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [stats, setStats] = useState<ProductStats[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("unitsSold");

  async function handleFile(file: File) {
    setStats(null);
    setFileName(file.name);
    const { rows, headers } = parseExport(await file.text());
    if (!looksLikeOrdersExport(headers)) {
      setFileWarning(
        looksLikeCustomersExport(headers)
          ? "This is a Customers export. Product Insights needs an Orders export."
          : "This doesn't look like a Shopify Orders export."
      );
      return;
    }
    setFileWarning(null);
    setStats(aggregateProductStats(rows));
  }

  const sorted = useMemo(() => {
    if (!stats) return [];
    return [...stats].sort((a, b) => b[sortKey] - a[sortKey]);
  }, [stats, sortKey]);

  function download() {
    if (!sorted.length) return;
    const csv = Papa.unparse(
      sorted.map((s) => ({ product: s.title, units_sold: s.unitsSold, orders: s.orderCount, revenue: s.revenue.toFixed(2) }))
    );
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product_performance.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-3xl">
      <label className="mb-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center hover:border-accent">
        <Upload size={18} className="text-zinc-500" />
        <span className="text-sm text-zinc-300">{fileName ?? "Upload a Shopify Orders export (.csv)"}</span>
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </label>
      {fileWarning && <p className="mb-4 text-xs text-status-warning">{fileWarning}</p>}

      {stats && (
        <>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-zinc-400">Sort by</span>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setSortKey(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${sortKey === key ? "bg-accent text-white" : "bg-zinc-900 text-zinc-400"}`}
              >
                {SORT_LABELS[key]}
              </button>
            ))}
            <button onClick={download} className="ml-auto rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
              Download CSV
            </button>
          </div>

          <div className="overflow-x-auto scrollbar-thin rounded-lg border border-zinc-900">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-zinc-200">
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Units sold</th>
                  <th className="px-3 py-2">Orders</th>
                  <th className="px-3 py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.title} className="border-b border-zinc-900 text-zinc-300">
                    <td className="px-3 py-1.5">{s.title}</td>
                    <td className="px-3 py-1.5">{s.unitsSold.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{s.orderCount.toLocaleString()}</td>
                    <td className="px-3 py-1.5">{s.revenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-zinc-500">No products found in this file.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
