"use client";

import { useState, useMemo } from "react";
import Papa from "papaparse";
import { Upload } from "lucide-react";
import GroupBuilder from "./GroupBuilder";
import {
  parseExport,
  readCsvFile,
  looksLikeOrdersExport,
  looksLikeCustomersExport,
  buildOrderProfiles,
  distinctProducts,
  suggestMinSpend,
  DEFAULT_RFM_PARAMS,
  type ExportRow,
  type RfmParams,
} from "@/lib/segmentRecipes";
import { aggregateProductStats } from "@/lib/productAnalytics";
import { orderFieldsPresentIn } from "@/lib/segmentFriendlyFields";
import { evaluateDefinition, evaluateGroup, newGroup, type SegmentDefinition } from "@/lib/segmentGroups";

type SortKey = "unitsSold" | "orderCount" | "revenue";

const SORT_LABELS: Record<SortKey, string> = {
  unitsSold: "Most sold",
  orderCount: "Most orders",
  revenue: "Highest revenue",
};

export default function ProductsClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [rows, setRows] = useState<ExportRow[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("unitsSold");
  // Optional: limit the product numbers to a segment built from include / exclude groups.
  const [useSegment, setUseSegment] = useState(false);
  const [definition, setDefinition] = useState<SegmentDefinition>({ include: [newGroup("rfm")], exclude: [] });
  const [defaultParams, setDefaultParams] = useState<RfmParams>(DEFAULT_RFM_PARAMS);

  async function handleFile(file: File) {
    setRows(null);
    setFileName(file.name);
    const { rows, headers } = parseExport(await readCsvFile(file));
    if (!looksLikeOrdersExport(headers)) {
      setFileWarning(
        looksLikeCustomersExport(headers)
          ? "This is a Customers export. Product Insights needs an Orders export."
          : "This doesn't look like a Shopify Orders export."
      );
      return;
    }
    setFileWarning(null);
    const params = { ...DEFAULT_RFM_PARAMS, minSpend: suggestMinSpend(buildOrderProfiles(rows)) };
    setDefaultParams(params);
    setDefinition({ include: [newGroup("rfm", params)], exclude: [] });
    setUseSegment(false);
    setRows(rows);
  }

  const profiles = useMemo(() => (rows ? buildOrderProfiles(rows) : null), [rows]);
  const products = useMemo(() => (rows ? distinctProducts(rows) : []), [rows]);
  const context = useMemo(() => (rows ? { rows, shape: "orders" as const, profiles } : null), [rows, profiles]);
  const segment = useMemo(() => (useSegment && context ? evaluateDefinition(definition, context) : null), [useSegment, context, definition]);
  const includeCounts = useMemo(() => (context ? definition.include.map((g) => evaluateGroup(g, context).length) : []), [context, definition.include]);
  const excludeCounts = useMemo(() => (context ? definition.exclude.map((g) => evaluateGroup(g, context).length) : []), [context, definition.exclude]);

  // The orders that belong to the segment's customers (all orders when no segment).
  const scopedRows = useMemo(() => {
    if (!rows) return null;
    if (!segment) return rows;
    const emails = new Set(segment.map((c) => c.email.trim().toLowerCase()));
    return rows.filter((r) => emails.has((r["Email"] || "").trim().toLowerCase()));
  }, [rows, segment]);
  const stats = useMemo(() => (scopedRows ? aggregateProductStats(scopedRows) : null), [scopedRows]);
  const orderCount = useMemo(() => (scopedRows ? new Set(scopedRows.map((r) => r["Name"])).size : 0), [scopedRows]);

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
    a.download = useSegment ? "product_performance_segment.csv" : "product_performance.csv";
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

      {rows && (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-100">
            <input type="checkbox" checked={useSegment} onChange={(e) => setUseSegment(e.target.checked)} className="accent-[var(--color-accent,#6366f1)]" />
            Limit to a segment
            <span className="text-xs font-normal text-zinc-500">Build one with include and exclude groups, like on the Segments tab.</span>
          </label>
          {useSegment && (
            <div className="mt-3 flex flex-col gap-3">
              <GroupBuilder
                mode="include"
                groups={definition.include}
                onChange={(next) => setDefinition((d) => ({ ...d, include: next }))}
                shape="orders"
                products={products}
                fields={rows ? orderFieldsPresentIn(rows) : []}
                defaultParams={defaultParams}
                counts={includeCounts}
              />
              <GroupBuilder
                mode="exclude"
                groups={definition.exclude}
                onChange={(next) => setDefinition((d) => ({ ...d, exclude: next }))}
                shape="orders"
                products={products}
                fields={rows ? orderFieldsPresentIn(rows) : []}
                defaultParams={defaultParams}
                counts={excludeCounts}
              />
              <p className="text-sm text-zinc-300">
                <span className="font-medium tabular-nums text-zinc-50">{(segment?.length ?? 0).toLocaleString()}</span> customers ·{" "}
                <span className="tabular-nums">{orderCount.toLocaleString()}</span> orders in this segment
              </p>
            </div>
          )}
        </div>
      )}

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
