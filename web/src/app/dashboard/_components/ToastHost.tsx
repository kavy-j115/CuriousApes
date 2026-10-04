"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import type { ToastType } from "@/lib/notify";

type Toast = { id: number; message: string; type: ToastType };

// Module-level so ids stay unique even if the effect below re-runs (hot reload, strict mode)
// while a toast is still on screen.
let nextId = 0;

// Shows messages sent through notify() (src/lib/notify.ts): a short "Saved"
// style popup that clears itself after a few seconds.
export default function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    function onToast(e: Event) {
      const { message, type } = (e as CustomEvent<{ message: string; type: ToastType }>).detail;
      const id = nextId++;
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === "error" ? 5000 : 2500);
    }
    window.addEventListener("app-toast", onToast);
    return () => window.removeEventListener("app-toast", onToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[120] flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex max-w-sm items-center gap-2 rounded-lg border px-3 py-2 text-sm shadow-xl ${
            t.type === "error"
              ? "border-status-bad/40 bg-zinc-950 text-status-bad"
              : "border-status-good/40 bg-zinc-950 text-zinc-100"
          }`}
        >
          {t.type === "error" ? <XCircle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0 text-status-good" />}
          {t.message}
        </div>
      ))}
    </div>
  );
}
