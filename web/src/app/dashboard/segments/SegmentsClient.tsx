"use client";

import { useState, useMemo } from "react";
import {
  parseCustomersExport,
  parseOrdersExport,
  looksLikeCustomersExport,
  looksLikeOrdersExport,
  repeatCustomersRecipe,
  highAovRecipe,
  winbackRecipe,
  customRecipe,
  toConvertWayCsv,
  RecipeResult,
} from "@/lib/segmentRecipes";
import ConditionBuilder, { type Condition, type FieldDef } from "./ConditionBuilder";

type RecipeKey = "repeat" | "high_aov" | "winback" | "custom";

const RECIPES: Record<RecipeKey, { label: string; fileType: "customers" | "orders" | "any"; description: string }> = {
  repeat: {
    label: "Repeat Customers",
    fileType: "customers",
    description: "Customers with at least N total orders. Upload a Customers export.",
  },
  high_aov: {
    label: "High AOV",
    fileType: "customers",
    description: "Customers whose average order value (Total Spent / Total Orders) is at least a threshold. Upload a Customers export.",
  },
  winback: {
    label: "Win-back / Inactive",
    fileType: "orders",
    description: "Customers whose most recent order was X-Y days ago. Upload an Orders export (has the dates Customers export lacks).",
  },
  custom: {
    label: "Custom",
    fileType: "any",
    description: "Define your own conditions on any column in the file -- including product-related ones (e.g. \"Lineitem name contains ...\") without a separate picker step.",
  },
};

const inputClass =
  "w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-100 focus:border-zinc-600 focus:outline-none";

function guessFieldType(header: string): FieldDef["type"] {
  if (/date|created|at$/i.test(header)) return "date";
  if (/price|spent|total|orders|quantity|value|count/i.test(header)) return "number";
  return "text";
}

export default function SegmentsClient() {
  const [recipe, setRecipe] = useState<RecipeKey>("repeat");
  const [minOrders, setMinOrders] = useState(2);
  const [minAov, setMinAov] = useState(5000);
  const [minDays, setMinDays] = useState(60);
  const [maxDays, setMaxDays] = useState(90);
  const [customConditions, setCustomConditions] = useState<Condition[]>([]);
  const [customShape, setCustomShape] = useState<"customers" | "orders">("orders");
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<RecipeResult | null>(null);

  const activeRecipe = RECIPES[recipe];

  const headers = useMemo(() => {
    if (!csvText) return [];
    return csvText.split("\n")[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  }, [csvText]);

  const customFields: FieldDef[] = useMemo(() => headers.map((h) => ({ key: h, label: h, type: guessFieldType(h) })), [headers]);

  function handleFile(file: File) {
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvText(text);
      const headerLine = text.split("\n")[0];
      const fileHeaders = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const isCustomers = looksLikeCustomersExport(fileHeaders);
      const isOrders = looksLikeOrdersExport(fileHeaders);
      if (activeRecipe.fileType === "any") {
        setCustomShape(isOrders ? "orders" : "customers");
        setFileWarning(null);
      } else if (activeRecipe.fileType === "customers" && !isCustomers) {
        setFileWarning(isOrders
          ? "This looks like an Orders export, but this recipe needs a Customers export."
          : "This doesn't look like a Shopify Customers export -- check the file.");
      } else if (activeRecipe.fileType === "orders" && !isOrders) {
        setFileWarning(isCustomers
          ? "This looks like a Customers export, but this recipe needs an Orders export."
          : "This doesn't look like a Shopify Orders export -- check the file.");
      } else {
        setFileWarning(null);
      }
    };
    reader.readAsText(file);
  }

  function process() {
    if (!csvText) return;
    if (recipe === "repeat" || recipe === "high_aov") {
      const rows = parseCustomersExport(csvText);
      setResult(recipe === "repeat" ? repeatCustomersRecipe(rows, minOrders) : highAovRecipe(rows, minAov));
    } else if (recipe === "winback") {
      setResult(winbackRecipe(parseOrdersExport(csvText), minDays, maxDays));
    } else {
      const rows = customShape === "orders" ? parseOrdersExport(csvText) : parseCustomersExport(csvText);
      const conditions = customConditions.map((c) => ({ column: c.field, operator: c.operator, value: c.value }));
      setResult(customRecipe(rows, conditions, customShape));
    }
  }

  function download() {
    if (!result) return;
    const csv = toConvertWayCsv(result.customers);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recipe}_convertway_export.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const skipCounts = result
    ? result.skipped.reduce<Record<string, number>>((acc, s) => {
        acc[s.reason] = (acc[s.reason] ?? 0) + 1;
        return acc;
      }, {})
    : {};

  return (
    <div className="max-w-2xl">
      <p className="mb-6 text-xs text-zinc-500">Runs entirely in your browser -- the file is never uploaded anywhere.</p>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-zinc-300">Campaign type</label>
        <select
          className={inputClass}
          value={recipe}
          onChange={(e) => {
            setRecipe(e.target.value as RecipeKey);
            setResult(null);
            setFileWarning(null);
          }}
        >
          {Object.entries(RECIPES).map(([key, r]) => (
            <option key={key} value={key}>{r.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">{activeRecipe.description}</p>
      </div>

      {recipe === "repeat" && (
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-zinc-300">Minimum total orders</label>
          <input type="number" min={1} value={minOrders} onChange={(e) => setMinOrders(Number(e.target.value))} className={`w-32 ${inputClass}`} />
        </div>
      )}

      {recipe === "high_aov" && (
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-zinc-300">Minimum average order value</label>
          <input type="number" min={0} value={minAov} onChange={(e) => setMinAov(Number(e.target.value))} className={`w-32 ${inputClass}`} />
        </div>
      )}

      {recipe === "winback" && (
        <div className="mb-4 flex items-center gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Days ago (min)</label>
            <input type="number" min={0} value={minDays} onChange={(e) => setMinDays(Number(e.target.value))} className={`w-24 ${inputClass}`} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-300">Days ago (max)</label>
            <input type="number" min={0} value={maxDays} onChange={(e) => setMaxDays(Number(e.target.value))} className={`w-24 ${inputClass}`} />
          </div>
        </div>
      )}

      {recipe === "custom" && (
        <div className="mb-4">
          {csvText && (
            <div className="mb-3 flex items-center gap-3 text-sm text-zinc-300">
              <span className="text-zinc-400">Treat this file as a</span>
              <select value={customShape} onChange={(e) => setCustomShape(e.target.value as "customers" | "orders")} className={`w-40 ${inputClass}`}>
                <option value="customers">Customers export</option>
                <option value="orders">Orders export</option>
              </select>
            </div>
          )}
          {!csvText && <p className="text-xs text-zinc-500">Upload a file below to build conditions on its columns.</p>}
          {csvText && <ConditionBuilder fields={customFields} conditions={customConditions} onChange={setCustomConditions} />}
        </div>
      )}

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-zinc-300">
          {activeRecipe.fileType === "customers" ? "Shopify Customers export (.csv)" : activeRecipe.fileType === "orders" ? "Shopify Orders export (.csv)" : "Shopify export (.csv)"}
        </label>
        <input
          type="file"
          accept=".csv"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="block text-sm text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-sky-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
        />
        {fileName && <p className="mt-1 text-xs text-zinc-500">Loaded: {fileName}</p>}
        {fileWarning && <p className="mt-1 text-xs text-amber-400">{fileWarning}</p>}
      </div>

      <button
        onClick={process}
        disabled={!csvText}
        className="mb-6 rounded bg-sky-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
      >
        Process
      </button>

      {result && (
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="mb-2 text-sm text-zinc-200">
            <span className="font-semibold">{result.customers.length}</span> customers ready to export
            {result.skipped.length > 0 && <span className="text-zinc-500"> ({result.skipped.length} skipped)</span>}
          </p>
          {Object.entries(skipCounts).map(([reason, count]) => (
            <p key={reason} className="text-xs text-zinc-500">
              {count} skipped ({reason === "no_phone" ? "no phone number" : "invalid phone number"})
            </p>
          ))}
          <button
            onClick={download}
            disabled={result.customers.length === 0}
            className="mt-3 rounded bg-lime-400 px-4 py-2 text-sm font-medium text-black disabled:opacity-40"
          >
            Download ConvertWay CSV
          </button>
        </div>
      )}
    </div>
  );
}
