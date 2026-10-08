"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { notify } from "@/lib/notify";
import { getClientSyncLog, startClientSync } from "../actions";

const DAY = 86400000;

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  return iso(new Date(Date.now() - n * DAY));
}

// The pop-up that starts a client's backfill: shown for a new client once its Shopify
// is connected, and when a paused client is reconnected. The range always ends at the
// last completed day; only the start is chosen (up to 60 days back, Shopify's limit).
export default function SyncNowModal({
  clientId,
  name,
  maxDays = 60,
  defaultFrom,
  onClose,
}: {
  clientId: string;
  name: string;
  maxDays?: number;
  defaultFrom: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const min = daysAgo(maxDays);
  const yesterday = daysAgo(1);
  const monthStart = iso(new Date(new Date(Date.now() - DAY).setUTCDate(1)));
  const initial = defaultFrom && defaultFrom >= min ? defaultFrom : monthStart;
  const [from, setFrom] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [started, setStarted] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [log, setLog] = useState<{ running: boolean; text: string } | null>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!started) return;
    let alive = true;
    const tick = async () => {
      try {
        const next = await getClientSyncLog(clientId);
        if (!alive) return;
        setLog(next);
        if (!next.running) router.refresh();
      } catch {
        /* keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [started, clientId, router]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const presets: { label: string; value: string }[] = [
    { label: "This month so far", value: monthStart },
    { label: "Last 7 days", value: daysAgo(7) },
    { label: "Last 30 days", value: daysAgo(30) },
    { label: "Last 60 days", value: daysAgo(60) },
    ...(maxDays > 60
      ? [
          { label: "Last 6 months", value: daysAgo(182) },
          { label: "Last year", value: daysAgo(365) },
          { label: "Everything (up to 5 years)", value: min },
        ]
      : []),
  ];
  const days = Math.max(0, Math.round((Date.parse(yesterday) - Date.parse(from)) / DAY) + 1);

  function start() {
    startTransition(async () => {
      const res = await startClientSync(clientId, from);
      if ("error" in res) {
        notify(res.error, "error");
        return;
      }
      if (res.started) {
        setStarted(true);
      } else {
        setSavedOnly(true);
        notify("Saved -- the next scheduled run will fetch these days");
        router.refresh();
      }
    });
  }

  const finished = started && log && !log.running;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-50">Sync {name} now</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Pick how far back to load Shopify data. It ends at the last completed day (yesterday); today is added tomorrow.
              Only reads from Shopify and Meta; everything is saved in our own database.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        {!started && !savedOnly && (
          <>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => setFrom(p.value)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${from === p.value ? "border-accent bg-accent/10 text-accent" : "border-zinc-800 text-zinc-300 hover:border-zinc-600"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
              <input
                type="date"
                value={from}
                min={min}
                max={yesterday}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100"
              />
              <span className="text-zinc-500">to</span>
              <span className="rounded-md border border-zinc-900 px-2.5 py-1.5 text-zinc-400">{yesterday}</span>
              <span className="text-xs text-zinc-500">({days} day{days === 1 ? "" : "s"})</span>
            </div>
            {defaultFrom && <p className="mt-2 text-xs text-zinc-500">Pre-filled with the day this client was paused, so only the missed days are loaded.</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600">
                Later
              </button>
              <button
                onClick={start}
                disabled={pending || !from || from < min || from > yesterday}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
              >
                {pending ? "Starting..." : "Sync now"}
              </button>
            </div>
          </>
        )}

        {started && (
          <>
            <p className="mt-4 text-xs font-medium text-zinc-400">{finished ? "Finished" : "Running..."} (from {from})</p>
            <pre ref={logRef} className="mt-2 max-h-64 overflow-auto rounded-md border border-zinc-900 bg-black/40 p-2 text-[11px] leading-snug text-zinc-300">
              {log?.text || "Starting..."}
            </pre>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600">
                {finished ? "Done" : "Close (keeps running)"}
              </button>
            </div>
          </>
        )}

        {savedOnly && (
          <>
            <p className="mt-4 text-sm text-zinc-300">Saved. Syncing starts with the next scheduled run (9 AM IST).</p>
            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300">
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
