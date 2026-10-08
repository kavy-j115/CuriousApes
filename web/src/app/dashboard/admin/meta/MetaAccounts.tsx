"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Eye, EyeOff, Search, Trash2 } from "lucide-react";
import { notify, withToast } from "@/lib/notify";
import Select from "../../_components/Select";
import Link from "next/link";
import { createMetaLoginLink, mapAdAccount, refreshMetaAccounts, removeMetaConnection } from "../actions";

type Connection = { id: string; name: string; expiresAt: string | null; connectedAt: string };
type Account = { id: string; name: string; business: string; active: boolean };
type ClientOption = { id: string; name: string; accountId: string | null };

const RESULT_MESSAGES: Record<string, string> = {
  cancelled: "The Facebook login was cancelled.",
  invalid: "That login link was incomplete. Try Connect Meta again.",
  expired: "That login link expired. Try Connect Meta again.",
  failed: "Meta didn't complete the connection. Try again, and check the app settings if it repeats.",
};

// The ad account ID is hidden like a password; the eye button shows it for that row only.
function MaskedId({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        type={shown ? "text" : "password"}
        value={value}
        readOnly
        aria-label="Ad account ID"
        autoComplete="off"
        className="w-36 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-300 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide ad account ID" : "Show ad account ID"}
        title={shown ? "Hide" : "Show"}
        className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-accent"
      >
        {shown ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </span>
  );
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\(read-only\)|private limited|pvt\.? ?ltd\.?|limited|\bltd\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function MetaAccounts({
  result,
  focusClientId,
  connections,
  accounts,
  clients,
}: {
  result: string | null;
  focusClientId: string | null;
  connections: Connection[];
  accounts: Account[];
  clients: ClientOption[];
}) {
  // Opened from a client card ("Link ad account"): that client is in focus, the search
  // starts on its name, and each ad account gets a one-click "Link to <client>".
  const focus = clients.find((c) => c.id === focusClientId) ?? null;
  const [query, setQuery] = useState(focus?.name ?? "");
  const [filter, setFilter] = useState<"all" | "linked" | "unlinked">("all");
  const [pending, startTransition] = useTransition();
  // What the last manual refresh found (kept only for this visit).
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [paused, setPaused] = useState<{ id: string; name: string }[]>([]);
  const [tooMany, setTooMany] = useState(false);

  useEffect(() => {
    if (!result) return;
    if (result.startsWith("connected:")) notify(`Meta connected -- ${result.slice("connected:".length)} ad accounts found`);
    else notify(RESULT_MESSAGES[result] ?? "Meta connection finished.", "error");
  }, [result]);

  // Which client (if any) each ad account is mapped to.
  const clientByAccount = useMemo(() => new Map(clients.filter((c) => c.accountId).map((c) => [c.accountId as string, c])), [clients]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => {
      if (filter === "linked" && !clientByAccount.has(a.id)) return false;
      if (filter === "unlinked" && clientByAccount.has(a.id)) return false;
      return !q || `${a.name} ${a.id} ${a.business}`.toLowerCase().includes(q);
    });
  }, [accounts, query, filter, clientByAccount]);
  const unlinkedClients = clients.filter((c) => !c.accountId).length;

  function refresh() {
    startTransition(async () => {
      try {
        const r = await refreshMetaAccounts();
        setNewIds(new Set(r.added));
        setPaused(r.paused);
        setTooMany(r.tooMany);
        notify(
          r.paused.length > 0
            ? `${r.paused.length} client${r.paused.length === 1 ? "" : "s"} lost Meta access and ${r.paused.length === 1 ? "was" : "were"} paused`
            : r.added.length === 0 && r.removed === 0
              ? "Ad accounts refreshed -- nothing changed"
              : `Refreshed: ${r.added.length} new, ${r.removed} no longer available`,
          r.paused.length > 0 || r.tooMany ? "error" : "success"
        );
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't refresh the ad accounts.", "error");
      }
    });
  }

  function connect() {
    startTransition(async () => {
      const r = await createMetaLoginLink();
      if ("error" in r) notify(r.error, "error");
      else window.location.href = r.url;
    });
  }

  function map(accountId: string, clientId: string) {
    startTransition(async () => {
      await withToast(() => mapAdAccount(accountId, clientId || null), clientId ? "Ad account linked to client" : "Ad account unlinked");
    });
  }

  // Suggests a client for each unmapped account by name, only when exactly one fits.
  function autoMatch() {
    const free = clients.filter((c) => !c.accountId);
    const pairs: [string, string][] = [];
    for (const a of accounts) {
      if (clientByAccount.has(a.id)) continue;
      const an = norm(a.name);
      const fits = free.filter((c) => {
        const cn = norm(c.name);
        return cn.length >= 4 && (an.includes(cn) || cn.includes(an)) && an.length >= 4;
      });
      if (fits.length === 1 && !pairs.some(([, cid]) => cid === fits[0].id)) pairs.push([a.id, fits[0].id]);
    }
    if (pairs.length === 0) {
      notify("No confident matches found -- link the rest by hand.", "error");
      return;
    }
    startTransition(async () => {
      for (const [accountId, clientId] of pairs) await mapAdAccount(accountId, clientId);
      notify(`${pairs.length} ad account${pairs.length === 1 ? "" : "s"} linked by name`);
    });
  }

  return (
    <div className="max-w-6xl">
      {focus && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 p-4">
          <div>
            <p className="text-sm font-semibold text-zinc-50">Linking an ad account for {focus.name}</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {focus.accountId
                ? "It already has one linked. Choose another account below to change it."
                : "Pick its ad account below. The search starts on the client's name."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/dashboard/admin/clients" className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-accent hover:text-accent">
              Back to Clients
            </Link>
            <Link href="/dashboard/admin/meta" className="text-xs text-zinc-400 hover:text-zinc-200">
              Show everything
            </Link>
          </div>
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Ad accounts visible", value: accounts.length, hint: `${accounts.filter((a) => a.active).length} active` },
          { label: "Clients linked", value: clientByAccount.size, hint: `of ${clients.length} clients` },
          { label: "Clients without an ad account", value: unlinkedClients, hint: unlinkedClients ? "link them below" : "all linked" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-50">{s.value}</p>
            <p className="text-xs text-zinc-500">{s.hint}</p>
          </div>
        ))}
      </div>

      <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-zinc-200">Connections</p>
          <button onClick={connect} disabled={pending} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {connections.length ? "Reconnect / add profile" : "Connect Meta"}
          </button>
          {connections.length > 0 && (
            <button
              onClick={refresh}
              disabled={pending}
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Refresh list
            </button>
          )}
        </div>
        {connections.length === 0 && <p className="text-sm text-zinc-500">No Meta login connected yet.</p>}
        <div className="flex flex-col gap-2">
          {connections.map((c) => {
            const left = c.expiresAt ? daysUntil(c.expiresAt) : null;
            const tone = left !== null && left <= 7 ? "text-status-bad" : left !== null && left <= 14 ? "text-status-warning" : "text-zinc-400";
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-zinc-100">{c.name}</span>
                <span className={`text-xs ${tone}`}>
                  {left === null ? "No expiry" : left > 0 ? `Expires in ${left} days (${new Date(c.expiresAt as string).toLocaleDateString()})` : "Expired -- reconnect"}
                </span>
                {left !== null && (
                  <span className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-800" aria-hidden="true">
                    <span
                      className={`block h-full rounded-full ${left <= 7 ? "bg-status-bad" : left <= 14 ? "bg-status-warning" : "bg-status-good"}`}
                      style={{ width: `${Math.max(2, Math.min(100, (left / 60) * 100))}%` }}
                    />
                  </span>
                )}
                <button
                  onClick={() => {
                    if (!confirm(`Remove ${c.name}'s connection? Clients linked through it stop updating until it is reconnected. The token is removed from our database only; to revoke it in Facebook, remove the app under the profile's Facebook settings (Business integrations).`)) return;
                    startTransition(async () => { await withToast(() => removeMetaConnection(c.id), "Connection removed"); });
                  }}
                  aria-label="Remove connection"
                  className="rounded p-1 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {paused.length > 0 && (
        <div className="mb-4 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 text-sm text-status-warning">
          <p className="font-medium">
            Meta access lost -- fetching stopped for {paused.length === 1 ? "this client" : `these ${paused.length} clients`}:
          </p>
          <p className="mt-1 text-zinc-200">{paused.map((c) => c.name).join(", ")}</p>
          <p className="mt-1 text-xs text-zinc-400">
            They are hidden and nothing is fetched; nothing was changed on Meta and no data was deleted. If they have left the
            agency, remove them from your client list on the{" "}
            <Link href="/dashboard/admin/clients" className="text-accent underline">Clients page</Link>.
          </p>
        </div>
      )}
      {tooMany && (
        <div className="mb-4 rounded-lg border border-status-bad/40 bg-status-bad/10 p-3 text-sm text-status-bad">
          Several clients lost their ad account at once. That usually means a Meta problem, so nothing was paused. Try Refresh
          list again in a while, or reconnect the Meta login.
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <Search size={14} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search ad accounts"
            className="w-56 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
          {(["all", "linked", "unlinked"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === f ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              {f === "all" ? "All" : f === "linked" ? "Linked" : "Not linked"}
            </button>
          ))}
        </div>
        <button onClick={autoMatch} disabled={pending || accounts.length === 0} className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:border-accent hover:text-accent disabled:opacity-50">
          Auto-match by name
        </button>
        <span className="text-xs text-zinc-500">
          {accounts.length} ad accounts · {clientByAccount.size} linked
        </span>
      </div>

      <div className="overflow-x-auto scrollbar-thin rounded-xl border border-zinc-800">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
              <th className="px-3 py-2">Ad account</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Client</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a) => {
              const linked = clientByAccount.get(a.id);
              return (
                <tr key={a.id} className="border-b border-zinc-900 text-zinc-300 hover:bg-zinc-900/40">
                  <td className="px-3 py-1.5">
                    {a.name}
                    {newIds.has(a.id) && <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">new</span>}
                    {!a.active && <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-400">not active</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <MaskedId value={a.id} />
                  </td>
                  <td className="px-3 py-1.5 text-xs text-zinc-500">{a.business || "—"}</td>
                  <td className="px-3 py-1.5">
                    {focus && (
                      <div className="mb-1.5">
                        {focus.accountId === a.id ? (
                          <span className="inline-flex items-center rounded-md bg-status-good/15 px-2 py-1 text-xs font-medium text-status-good">Linked to {focus.name}</span>
                        ) : (
                          <button
                            onClick={() => map(a.id, focus.id)}
                            disabled={pending}
                            className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Link to {focus.name}
                          </button>
                        )}
                      </div>
                    )}
                    <Select value={linked?.id ?? ""} onChange={(v) => map(a.id, v)}>
                      <option value="">Not linked</option>
                      {/* Only clients still without an ad account (plus the one already linked
                          to this row). A client that has one appears only when "Change Meta
                          account" was used on its card, i.e. it is the one in focus. */}
                      {clients
                        .filter((c) => !c.accountId || c.id === linked?.id || c.id === focus?.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.accountId && c.accountId !== a.id ? " (has another account)" : ""}
                          </option>
                        ))}
                    </Select>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-zinc-500">
                  {accounts.length === 0 ? "Connect Meta to load your ad accounts." : "No ad accounts match."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
