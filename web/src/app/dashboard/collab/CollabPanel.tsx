"use client";

import { notify } from "@/lib/notify";
import { useState, useTransition } from "react";
import Select from "../_components/Select";
import { shareClientWithUser, revokeShare } from "./actions";

type Client = { client_id: string; display_name: string };
type Colleague = { id: string; label: string };
type Grant = { user_id: string; client_id: string; expires_at: string };

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
}

export default function CollabPanel({
  clients,
  colleagues,
  grants,
}: {
  clients: Client[];
  colleagues: Colleague[];
  grants: Grant[];
}) {
  const [clientId, setClientId] = useState("");
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const clientName = (id: string) => clients.find((c) => c.client_id === id)?.display_name ?? id;
  const userName = (id: string) => colleagues.find((c) => c.id === id)?.label ?? "Someone";

  function share() {
    if (!clientId || !userId) return;
    setMessage(null);
    startTransition(async () => {
      const result = await shareClientWithUser(clientId, userId);
      if ("error" in result) setMessage(result.error);
      else {
        setMessage(null);
        setUserId("");
        notify("Shared for 24 hours");
      }
    });
  }

  function revoke(g: Grant) {
    setMessage(null);
    startTransition(async () => {
      const result = await revokeShare(g.client_id, g.user_id);
      if ("error" in result) setMessage(result.error);
      else notify("Access ended");
    });
  }

  if (clients.length === 0) {
    return <p className="text-sm text-zinc-500">You don&apos;t have any clients to share yet.</p>;
  }

  return (
    <div data-tour="collab-panel" className="max-w-xl">
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Select value={clientId} onChange={setClientId}>
          <option value="">Client…</option>
          {clients.map((c) => (
            <option key={c.client_id} value={c.client_id}>{c.display_name}</option>
          ))}
        </Select>
        <Select value={userId} onChange={setUserId}>
          <option value="">Colleague…</option>
          {colleagues.map((u) => (
            <option key={u.id} value={u.id}>{u.label}</option>
          ))}
        </Select>
        <button
          onClick={share}
          disabled={!clientId || !userId || pending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          Give 24h access
        </button>
      </div>
      {message && <p className="mb-4 text-sm text-status-bad">{message}</p>}

      <h2 className="mb-2 text-sm font-semibold text-zinc-200">Active</h2>
      {grants.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing shared right now.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {grants.map((g) => (
            <div key={`${g.user_id}-${g.client_id}`} className="flex items-center gap-3 rounded-lg border border-zinc-900 px-3 py-2 text-sm">
              <span className="text-zinc-200">{userName(g.user_id)}</span>
              <span className="text-zinc-500">→</span>
              <span className="text-zinc-300">{clientName(g.client_id)}</span>
              <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-xs text-status-warning">{hoursLeft(g.expires_at)}h left</span>
              <button onClick={() => revoke(g)} disabled={pending} className="ml-auto text-xs text-zinc-500 hover:text-status-bad">
                revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
