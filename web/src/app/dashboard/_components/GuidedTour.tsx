"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { disablePageTours, markPageTourSeen, markTourSeen } from "../tourActions";
import type { Role } from "@/lib/auth/profile";

type Step = { target?: string; title: string; body: string };

const DASHBOARD_STEPS: Record<string, Step> = {
  dashboard: { target: "nav-Dashboard", title: "Dashboard", body: "Revenue, orders, customers and trends for the last 30 days." },
  reports: { target: "nav-Reports", title: "Reports", body: "Daily numbers for this month or any date range, as a table or chart. Download the Excel report from here." },
  comparisons: { target: "nav-Comparisons", title: "Comparisons", body: "Put two date ranges side by side." },
  alerts: { target: "nav-Alerts", title: "Alerts", body: "Drops in revenue or ROAS, rising CAC, sync failures and data issues." },
  ai: { target: "nav-AI Report", title: "AI Report", body: "A plain-language summary of each day's numbers." },
  segments: { target: "nav-Segments", title: "Segments", body: "Build customer lists from a Shopify export, and see which products sell best." },
  collab: { target: "nav-Collab", title: "Collab", body: "Give a colleague 24-hour access to one of your clients, for example while you're out." },
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
  if (role !== "client") steps.push(s.segments, s.collab);
  if (role === "admin") steps.push(s.clients, s.users);
  steps.push({ title: "You're set", body: "Every page also has its own tutorial: use the Tutorial button at the bottom of the sidebar." });
  return steps;
}

// One short walkthrough per page, keyed by pathname. Targets are data-tour
// attributes on the page's own elements; a step whose target isn't on screen
// is shown as a centered card instead.
const PAGE_TOURS: Record<string, Step[]> = {
  "/dashboard": [
    { target: "dash-dates", title: "What you're looking at", body: "The client and date range are shown here. Pick 7D, 30D, 90D, This month or a custom range to change every number and chart below." },
    { target: "dash-tiles", title: "Key numbers", body: "Gross sales, orders, AOV and customer counts for that range. The arrow compares with the same number of days just before it." },
    { target: "dash-charts", title: "Trends", body: "Daily revenue, orders and ad performance over the same range." },
  ],
  "/dashboard/reports": [
    { target: "report-views", title: "Table or chart", body: "Switch between the daily table and charts of the same days." },
    { target: "report-dates", title: "Date range", body: "\"This month\" shows every day from the 1st up to yesterday with a Total row. Today appears tomorrow, once the day is complete. Pick 7D, 30D, 90D or Custom to see a different range instead." },
    { target: "report-download", title: "Download", body: "Downloads an Excel file of exactly what is on screen, in the same format." },
    { target: "report-table", title: "The report", body: "One row per day and a Total row at the bottom. PROAS is coloured green when it reaches the client's ideal ROAS and fades towards red as it drops." },
  ],
  "/dashboard/comparisons": [
    { target: "compare-controls", title: "Choose two periods", body: "Pick a preset or set the dates for Period A and Period B, then compare." },
    { target: "compare-results", title: "Results", body: "Each metric side by side with the change between the periods, followed by charts and the daily rows for each." },
  ],
  "/dashboard/alerts": [
    { target: "alerts-list", title: "Alerts", body: "Revenue or ROAS drops, rising CAC, sync failures and data issues for this client. Each one shows whether it was sent over WhatsApp." },
  ],
  "/dashboard/ai-report": [
    { target: "ai-body", title: "AI Daily Report", body: "A plain-language summary of the day's numbers. Use the date picker to read an earlier day." },
  ],
  "/dashboard/segments": [
    { target: "segment-wizard", title: "Build a customer list", body: "Four steps: upload a Shopify Orders or Customers export, build the segment from Include and Exclude groups (RFM tiers, product affinity or custom conditions), optionally upload a template with the columns you want, then download the list. Product Insights can be limited to a segment built the same way." },
  ],
  "/dashboard/collab": [
    { target: "collab-panel", title: "Share a client", body: "Pick one of your clients and a colleague to give them access for 24 hours. You can end it early from the list below." },
  ],
  "/dashboard/admin/clients": [
    { target: "client-create", title: "Add a client", body: "Brand name, the client's login email, their Shopify store and GA4 ID, the ideal ROAS, alert limits and WhatsApp numbers. Link their Meta ad account on the Meta Accounts page. Syncing stays off until you switch it on, and the first sync loads up to 60 days of Shopify in one bulk export, and 3 days of Meta." },
    { target: "client-table", title: "Manage clients", body: "Each row has its report columns and colours, alerts and WhatsApp numbers, access, connections and the sync switch." },
  ],
  "/dashboard/admin/users": [
    { target: "user-create", title: "Create a user", body: "Make an Admin or User account and choose which clients they can see." },
    { target: "user-list", title: "Existing users", body: "Change a role, adjust client access, or give a colleague 24-hour access." },
  ],
  "/dashboard/admin/meta": [
    { target: "meta-accounts", title: "Meta Accounts", body: "Connect Meta once with a Facebook login. Every ad account that profile can reach is listed here. Link each one to its client, or use Auto-match by name. If the login's expiry date gets close, press Reconnect once and every client keeps updating." },
  ],
  "/dashboard/admin/permissions": [
    { target: "permissions-filter", title: "Permissions", body: "Choose Everyone, Clients, Users or Admins to see only those rows, with the clients each person can see. A 24h tag marks a temporary collab grant." },
  ],
  "/dashboard/admin/data-sources": [
    { title: "Data Sources", body: "Shows which clients have Shopify, Meta and GA4 connected and when each last synced." },
  ],
  "/dashboard/admin/settings": [
    { title: "System Settings", body: "The WhatsApp sender the platform uses for alerts and reports." },
  ],
};

const CARD_WIDTH = 320;
const PAD = 6;
// Walkthrough that dims the page, spotlights a real element for each step and
// explains it. Two kinds: the app tour (first login, or "Take the tour" in the
// profile menu) and a tutorial for the page you are on (runs the first time you
// open that page, and from the sidebar's Tutorial button any time after).
export default function GuidedTour({
  role,
  autoStart,
  seenPages,
  pageToursDisabled,
}: {
  role: Role;
  autoStart: boolean;
  seenPages: string[];
  pageToursDisabled: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(autoStart);
  // Remembered per user in the database. "Skip tour" on the main tour switches the
  // automatic page tutorials off for good.
  const [appTourPending, setAppTourPending] = useState(autoStart);
  const [seen, setSeen] = useState<Set<string>>(() => new Set(seenPages));
  const [autoPageToursOff, setAutoPageToursOff] = useState(pageToursDisabled);
  const [mode, setMode] = useState<"app" | "page">("app");
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const steps = useMemo(() => (mode === "page" ? PAGE_TOURS[pathname] ?? stepsFor(role) : stepsFor(role)), [mode, pathname, role]);
  const step = steps[index];

  const finish = useCallback(
    (skipped = false) => {
      setOpen(false);
      setIndex(0);
      if (mode === "app") {
        void markTourSeen();
        setAppTourPending(false);
        if (skipped) {
          setAutoPageToursOff(true);
          void disablePageTours();
        } else {
          // Finished the main tour: don't chain straight into this page's tutorial.
          setSeen((prev) => new Set(prev).add(pathname));
          void markPageTourSeen(pathname);
        }
      } else {
        setSeen((prev) => new Set(prev).add(pathname));
        void markPageTourSeen(pathname);
      }
    },
    [mode, pathname]
  );

  useEffect(() => {
    function start(e: Event) {
      const kind = (e as CustomEvent<{ kind?: string }>).detail?.kind;
      setMode(kind === "page" && PAGE_TOURS[pathname] ? "page" : "app");
      setIndex(0);
      setOpen(true);
    }
    window.addEventListener("start-tour", start);
    return () => window.removeEventListener("start-tour", start);
  }, [pathname]);

  // First visit to a page: show its tutorial once -- never while the main tour is
  // pending, never after "Skip tour", and never for a page this user has already seen.
  useEffect(() => {
    if (appTourPending || autoPageToursOff || !PAGE_TOURS[pathname] || seen.has(pathname)) return;
    const t = setTimeout(() => {
      setMode("page");
      setIndex(0);
      setOpen(true);
    }, 900);
    return () => clearTimeout(t);
  }, [pathname, appTourPending, autoPageToursOff, seen]);

  useEffect(() => {
    if (!open) return;
    function measure() {
      const target = steps[index]?.target;
      const el = target
        ? Array.from(document.querySelectorAll(`[data-tour="${target}"]`)).find((e) => e.getBoundingClientRect().width > 0)
        : undefined;
      if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
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
      if (e.key === "Escape") finish(true);
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

  // The card is never allowed to leave the screen: it goes beside the target
  // when there is room, otherwise below or above it, and is finally clamped to
  // the viewport (over the target if the target is as tall as the screen).
  const CARD_H = 230;
  let cardStyle: React.CSSProperties | undefined;
  if (rect) {
    const left = Math.max(12, Math.min(rect.left, vw - CARD_WIDTH - 12));
    let top: number;
    let leftPos = left;
    if (rect.right + 16 + CARD_WIDTH < vw && rect.width < vw * 0.5) {
      leftPos = rect.right + 16;
      top = rect.top - 8;
    } else if (rect.bottom + 14 + CARD_H < vh) {
      top = rect.bottom + 14;
    } else if (rect.top - 14 - CARD_H > 0) {
      top = rect.top - 14 - CARD_H;
    } else {
      top = vh - CARD_H - 16;
    }
    cardStyle = { left: leftPos, top: Math.max(12, Math.min(top, vh - CARD_H - 12)) };
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
          <button onClick={() => finish(true)} className="text-xs text-zinc-500 hover:text-zinc-300">
            Skip tour
          </button>
        )}
        <div className="ml-auto flex gap-2">
          {index > 0 && (
            <button onClick={() => setIndex(index - 1)} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-700">
              Back
            </button>
          )}
          <button onClick={last ? () => finish(false) : () => setIndex(index + 1)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white">
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
