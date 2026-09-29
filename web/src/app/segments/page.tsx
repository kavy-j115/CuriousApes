"use client";

import { useState } from "react";
import Link from "next/link";
import {
  parseCustomersExport,
  parseOrdersExport,
  looksLikeCustomersExport,
  looksLikeOrdersExport,
  repeatCustomersRecipe,
  highAovRecipe,
  winbackRecipe,
  toConvertWayCsv,
  RecipeResult,
} from "@/lib/segmentRecipes";

type RecipeKey = "repeat" | "high_aov" | "winback";

const RECIPES: Record<RecipeKey, { label: string; fileType: "customers" | "orders"; description: string }> = {
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
};

export default function SegmentsPage() {
  const [recipe, setRecipe] = useState<RecipeKey>("repeat");
  const [minOrders, setMinOrders] = useState(2);
  const [minAov, setMinAov] = useState(5000);
  const [minDays, setMinDays] = useState(60);
  const [maxDays, setMaxDays] = useState(90);
  const [fileWarning, setFileWarning] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<RecipeResult | null>(null);

  const activeRecipe = RECIPES[recipe];

  function handleFile(file: File) {
    setResult(null);
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setCsvText(text);
      const headerLine = text.split("\n")[0];
      const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const isCustomers = looksLikeCustomersExport(headers);
      const isOrders = looksLikeOrdersExport(headers);

      if (activeRecipe.fileType === "customers" && !isCustomers) {
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
    if (activeRecipe.fileType === "customers") {
      const rows = parseCustomersExport(csvText);
      setResult(recipe === "repeat" ? repeatCustomersRecipe(rows, minOrders) : highAovRecipe(rows, minAov));
    } else {
      const rows = parseOrdersExport(csvText);
      setResult(winbackRecipe(rows, minDays, maxDays));
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
    <div className="min-h-screen bg-zinc-50 p-8 font-sans dark:bg-black">
      <main className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/" className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Campaign Segment Export
          </h1>
        </div>

        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          Upload a raw Shopify export, pick what you're building the segment for, and download
          a ConvertWay-ready CSV. Everything runs in your browser -- the file is never uploaded
          anywhere, not even to our own servers.
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Campaign type</label>
          <select
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
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
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Minimum total orders</label>
            <input
              type="number"
              min={1}
              value={minOrders}
              onChange={(e) => setMinOrders(Number(e.target.value))}
              className="w-32 rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        {recipe === "high_aov" && (
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Minimum average order value</label>
            <input
              type="number"
              min={0}
              value={minAov}
              onChange={(e) => setMinAov(Number(e.target.value))}
              className="w-32 rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
        )}

        {recipe === "winback" && (
          <div className="mb-4 flex items-center gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Days ago (min)</label>
              <input
                type="number"
                min={0}
                value={minDays}
                onChange={(e) => setMinDays(Number(e.target.value))}
                className="w-24 rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Days ago (max)</label>
              <input
                type="number"
                min={0}
                value={maxDays}
                onChange={(e) => setMaxDays(Number(e.target.value))}
                className="w-24 rounded border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {activeRecipe.fileType === "customers" ? "Shopify Customers export (.csv)" : "Shopify Orders export (.csv)"}
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            className="block w-full text-sm text-zinc-600 dark:text-zinc-400"
          />
          {fileName && <p className="mt-1 text-xs text-zinc-500">Loaded: {fileName}</p>}
          {fileWarning && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">{fileWarning}</p>
          )}
        </div>

        <button
          onClick={process}
          disabled={!csvText}
          className="mb-6 rounded bg-[#4472C4] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Process
        </button>

        {result && (
          <div className="rounded border border-zinc-300 p-4 dark:border-zinc-700">
            <p className="mb-2 text-sm">
              <span className="font-semibold">{result.customers.length}</span> customers ready to export
              {result.skipped.length > 0 && (
                <span className="text-zinc-500"> ({result.skipped.length} skipped)</span>
              )}
            </p>
            {Object.entries(skipCounts).map(([reason, count]) => (
              <p key={reason} className="text-xs text-zinc-500">
                {count} skipped ({reason === "no_phone" ? "no phone number" : "invalid phone number"})
              </p>
            ))}
            <button
              onClick={download}
              disabled={result.customers.length === 0}
              className="mt-3 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              Download ConvertWay CSV
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
