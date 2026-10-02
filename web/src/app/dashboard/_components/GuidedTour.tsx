"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { markTourSeen } from "../tourActions";
import type { Role } from "@/lib/auth/profile";

type Step = { target?: string; title: string; body: string };

const DASHBOARD_STEPS: Record<string, Step> = {
  dashboard: { target: "nav-Dashboard", title: "Dashboard", body: "Revenue, orders, customers and trends for the last 30 days." },
  reports: { target: "nav-Reports", title: "Reports", body: "Daily numbers for any date range, as a table or chart. Download the Excel report from here." },
  comparisons: { target: "nav-Comparisons", title: "Comparisons", body: "Put two date ranges side by side." },
  alerts: { target: "nav-Alerts", title: "Alerts", body: "Drops in revenue or ROAS, rising CAC, sync failures and data issues." },
  ai: { target: "nav-AI Report", title: "AI Report", body: "A plain-language summary of each day's numbers." },
  segments: { target: "nav-Segments", title: "Segments", body: "Build customer lists from a Shopify export, and see which products sell best." },
  clients: { target: "nav-Clients", title: "Clients", body: "Add a client, connect their Shopify, Meta and GA4, and switch syncing on." },
  users: { target: "nav-Users", title: "Users", body: "Create accounts and choose which clients each person can see." },
};

function stepsFor(role: Role): Step[] {
  const s = DASHBOARD_STEPS;
  const steps: Step[] = [{ title: "Welcome to Curious Apes", body: "A quick tour of where everything is. It takes under a minute." }];
  if (role !== "client") {
    steps.push({ target: "client-dropdown", title: "Client switcher", body: "Choose which client you're viewing. It stays selected as you move between pages." });
  }
  steps.push(s.dashboard, s.reports, s.comparisons, s.alerts, s.ai);
  if (role !== "client") steps.push(s.segments);
  if (role === "admin") steps.push(s.clients, s.users);
  steps.push({ title: "You're set", body: "You can replay this tour any time from your profile menu." });
  return steps;
}

const CARD_WIDTH = 320;
const PAD = 6;

// First-login walkthrough: dims the page, spotlights the real nav item or
// control for each step, and explains it. Steps are built per role so a
// client is never shown something they can't open. Targets are located via
// data-tour attributes; if one isn't visible (e.g. the sidebar is hidden on
// a phone) the step falls back to a centered card instead of pointing at
// nothing.
export default function GuidedTour({ role, autoStart }: { role: Role; autoStart: boolean }) {
  const [open, setOpen] = useState(autoStart);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const steps = useMemo(() => stepsFor(role), [role]);
  const step = steps[index];

  const finish = useCallback(() => {
    setOpen(false);
    setIndex(0);
    void markTourSeen();
  }, []);

  useEffect(() => {
    function start() {
      setIndex(0);
      setOpen(true);
    }
    window.addEventListener("start-tour", start);
    return () => window.removeEventListener("start-tour", start);
  }, []);

  useEffect(() => {
    if (!open) return;
    function measure() {
      const target = steps[index]?.target;
      const el = target
        ? Array.from(document.querySelectorAll(`[data-tour="${target}"]`)).find((e) => e.getBoundingClientRect().width > 0)
        : undefined;
      setRect(el ? el.getBoundingClientRect() : null);
    }
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [open, index, steps]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, steps.length, finish]);

  if (!open || !step) return null;

  const last = index === steps.length - 1;
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;

  let cardStyle: React.CSSProperties | undefined;
  if (rect) {
    const roomRight = rect.right + 16 + CARD_WIDTH < vw;
    cardStyle = roomRight
      ? { left: rect.right + 16, top: Math.min(Math.max(rect.top - 8, 12), vh - 220) }
      : { left: Math.max(12, Math.min(rect.right - CARD_WIDTH, vw - CARD_WIDTH - 12)), top: rect.bottom + 14 };
  }

  const card = (
    <div
      style={{ width: CARD_WIDTH, maxWidth: "calc(100vw - 24px)", ...cardStyle }}
      className={`rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl ${rect ? "absolute" : ""}`}
      role="dialog"
      aria-label={step.title}
    >
      <p className="mb-1 text-[11px] font-medium tracking-wide text-zinc-500">
        {index + 1} / {steps.length}
      </p>
      <h2 className="mb-1 text-base font-semibold text-zinc-50">{step.title}</h2>
      <p className="mb-4 text-sm leading-relaxed text-zinc-400">{step.body}</p>
      <div className="flex items-center gap-2">
        {!last && (
          <button onClick={finish} className="text-xs text-zinc-500 hover:text-zinc-300">
            Skip tour
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {index > 0 && (
            <button onClick={() => setIndex(index - 1)} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700">
              Back
            </button>
          )}
          <button onClick={last ? finish : () => setIndex(index + 1)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[100]">
      {rect ? (
        <>
          <div
            className="absolute rounded-lg ring-2 ring-accent transition-all"
            style={{
              left: rect.left - PAD,
              top: rect.top - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
            }}
          />
          {card}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-black/72 p-3">{card}</div>
      )}
    </div>
  );
}
