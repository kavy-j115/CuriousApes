"use client";

import { useState } from "react";
import SegmentWizard from "./SegmentWizard";
import ProductsClient from "./ProductsClient";

type Tab = "segments" | "products";

export default function SegmentsApp() {
  const [tab, setTab] = useState<Tab>("segments");

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-full bg-zinc-900 p-1 w-fit">
        <button
          onClick={() => setTab("segments")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${tab === "segments" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
        >
          Segments
        </button>
        <button
          onClick={() => setTab("products")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${tab === "products" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
        >
          Product Insights
        </button>
      </div>

      {tab === "segments" ? <SegmentWizard /> : <ProductsClient />}
    </div>
  );
}
