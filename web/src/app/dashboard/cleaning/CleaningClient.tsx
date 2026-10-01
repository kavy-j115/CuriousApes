"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  parseCsv,
  detectColumns,
  defaultParams,
  cleanRows,
  toCsv,
  DetectedColumns,
  CleaningParams,
  CleaningSummary,
  Row,
} from "@/lib/dataCleaning";

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-sky-500 focus:outline-none";

export default function CleaningClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [detected, setDetected] = useState<DetectedColumns | null>(null);
  const [params, setParams] = useState<CleaningParams | null>(null);
  const [summary, setSummary] = useState<CleaningSummary | null>(null);
  const [cleanedRows, setCleanedRows] = useState<Row[] | null>(null);
  const [requiredOpen, setRequiredOpen] = useState(false);

  function handleFile(file: File) {
    setSummary(null);
    setCleanedRows(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const { headers: h, rows: r } = parseCsv(text);
      const d = detectColumns(h);
      setHeaders(h);
      setRows(r);
      setDetected(d);
      setParams(defaultParams(d));
    };
    reader.readAsText(file);
  }

  function updateParams(patch: Partial<CleaningParams>) {
    setParams((p) => (p ? { ...p, ...patch } : p));
  }

  function runClean() {
    if (!params) return;
    const { rows: cleaned, summary: s } = cleanRows(rows, headers, params);
    setCleanedRows(cleaned);
    setSummary(s);
  }

  function download() {
    if (!cleanedRows) return;
    const csv = toCsv(cleanedRows, headers);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName ? `cleaned_${fileName}` : "cleaned_export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleRequiredColumn(col: string) {
    if (!params) return;
    const set = new Set(params.requiredColumns);
    if (set.has(col)) set.delete(col);
    else set.add(col);
    updateParams({ requiredColumns: Array.from(set) });
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="block text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-sky-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        {fileName && <p className="text-xs text-zinc-500">{fileName} · {rows.length} rows</p>}
      </div>

      {detected && params && (
        <div className="mb-6 flex flex-col gap-4 rounded-lg border border-zinc-800 p-4">
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={params.trimWhitespace} onChange={(e) => updateParams({ trimWhitespace: e.target.checked })} />
              Trim whitespace
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={params.dedupeExact} onChange={(e) => updateParams({ dedupeExact: e.target.checked })} />
              Remove exact duplicates
            </label>
          </div>

          {detected.keyLikeColumns.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <span className="text-zinc-400">Treat rows as duplicates if they have the same</span>
              <select
                className={inputClass}
                value={params.dedupeByColumn ?? ""}
                onChange={(e) => updateParams({ dedupeByColumn: e.target.value || null })}
              >
                <option value="">off</option>
                {detected.keyLikeColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {detected.emailColumns.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
              <span className="text-zinc-400">Email</span>
              <select className={inputClass} value={params.emailColumn ?? ""} onChange={(e) => updateParams({ emailColumn: e.target.value || null })}>
                {detected.emailColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={params.dropInvalidEmail} onChange={(e) => updateParams({ dropInvalidEmail: e.target.checked })} />
                drop invalid
              </label>
            </div>
          )}

          {detected.phoneColumns.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-300">
              <span className="text-zinc-400">Phone</span>
              <select className={inputClass} value={params.phoneColumn ?? ""} onChange={(e) => updateParams({ phoneColumn: e.target.value || null })}>
                {detected.phoneColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={params.dropInvalidPhone} onChange={(e) => updateParams({ dropInvalidPhone: e.target.checked })} />
                drop unparseable
              </label>
            </div>
          )}

          {detected.isOrdersExport && (
            <div className="flex flex-col gap-2 text-sm text-zinc-300">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={params.checkOrderTotals} onChange={(e) => updateParams({ checkOrderTotals: e.target.checked })} />
                Check order totals vs. line items
              </label>
              {params.checkOrderTotals && (
                <label className="ml-6 flex items-center gap-2 text-xs text-zinc-400">
                  <input type="checkbox" checked={params.excludeMismatchedOrders} onChange={(e) => updateParams({ excludeMismatchedOrders: e.target.checked })} />
                  Exclude mismatches (otherwise just flagged)
                </label>
              )}
            </div>
          )}

          <div>
            <button onClick={() => setRequiredOpen((v) => !v)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200">
              {requiredOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Required fields{params.requiredColumns.length > 0 ? ` (${params.requiredColumns.length})` : ""}
            </button>
            {requiredOpen && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                {headers.map((h) => (
                  <label key={h} className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <input type="checkbox" checked={params.requiredColumns.includes(h)} onChange={() => toggleRequiredColumn(h)} />
                    {h}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button onClick={runClean} className="self-start rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white">
            Clean data
          </button>
        </div>
      )}

      {summary && (
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="mb-2 text-sm text-zinc-200">
            <span className="font-semibold">{summary.outputRows}</span> of {summary.totalRows} rows kept
          </p>
          <ul className="space-y-1 text-xs text-zinc-500">
            {summary.removedDuplicateExact > 0 && <li>{summary.removedDuplicateExact} exact duplicate rows removed</li>}
            {summary.removedDuplicateByColumn > 0 && <li>{summary.removedDuplicateByColumn} duplicate rows removed by key column</li>}
            {summary.removedMissingRequired > 0 && <li>{summary.removedMissingRequired} rows removed for missing a required column</li>}
            {summary.removedInvalidEmail > 0 && <li>{summary.removedInvalidEmail} rows removed for an invalid email</li>}
            {summary.removedInvalidPhone > 0 && <li>{summary.removedInvalidPhone} rows removed for an unparseable phone</li>}
            {summary.orderTotalMismatches > 0 && (
              <li className="text-amber-400">
                {summary.orderTotalMismatches} order(s) where Total didn&apos;t match the sum of line items
                {summary.removedMismatchedOrders > 0 ? ` (${summary.removedMismatchedOrders} rows excluded)` : " (kept, flagged only)"}
              </li>
            )}
          </ul>
          <button onClick={download} className="mt-3 rounded bg-lime-400 px-4 py-2 text-sm font-medium text-black">
            Download cleaned CSV
          </button>
        </div>
      )}
    </div>
  );
}
