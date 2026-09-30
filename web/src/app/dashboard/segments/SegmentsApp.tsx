"use client";

import { useState } from "react";
import SegmentsClient from "./SegmentsClient";
import InternalSelectClient from "./InternalSelectClient";

type Mode = "upload" | "internal";

export default function SegmentsApp({ clientId }: { clientId: string }) {
  const [mode, setMode] = useState<Mode>("internal");

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-full bg-zinc-900 p-1 w-fit">
        <button
          onClick={() => setMode("internal")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${mode === "internal" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
        >
          Select from our data
        </button>
        <button
          onClick={() => setMode("upload")}
          className={`rounded-full px-3 py-1 text-xs font-medium ${mode === "upload" ? "bg-zinc-700 text-zinc-50" : "text-zinc-400"}`}
        >
          Upload a file
        </button>
      </div>

      {mode === "internal" ? <InternalSelectClient clientId={clientId} /> : <SegmentsClient />}
    </div>
  );
}
