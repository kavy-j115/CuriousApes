"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  updateUserRole,
  setUserClientAccess,
  grantTemporaryAccess,
  grantCollabWithUser,
  revokeAccess,
  deleteUserRecord,
} from "../actions";
import Select from "../../_components/Select";
import MultiSelect from "../../_components/MultiSelect";
import type { Role } from "@/lib/auth/profile";

type Client = { client_id: string; display_name: string };
type AccessRow = { client_id: string; expires_at: string | null };
type UserWithAccess = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  access: AccessRow[];
};
type CollabCandidate = { id: string; label: string };

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
}

export default function UserRow({
  user,
  clients,
  collabCandidates,
  currentUserId,
}: {
  user: UserWithAccess;
  clients: Client[];
  collabCandidates: CollabCandidate[]; // other non-admin users who have clients to share
  currentUserId: string;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const permanentIds = user.access.filter((a) => !a.expires_at).map((a) => a.client_id);
  const temporary = user.access.filter((a) => a.expires_at);
  const [selected, setSelected] = useState<string[]>(permanentIds);
  const [collabTarget, setCollabTarget] = useState(""); // "user:<id>" or "client:<id>"
  const [collabMessage, setCollabMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deleted, setDeleted] = useState<{ fullyDeleted: boolean } | null>(null);
  const isSelf = user.id === currentUserId;

  const unassignedClients = clients.filter(
    (c) => !permanentIds.includes(c.client_id) && !temporary.some((t) => t.client_id === c.client_id)
  );
  const otherUsers = collabCandidates.filter((c) => c.id !== user.id);

  function handleRoleChange(newRole: Role) {
    setRole(newRole);
    startTransition(async () => {
      await updateUserRole(user.id, newRole);
    });
  }

  function saveAccess() {
    startTransition(async () => {
      await setUserClientAccess(user.id, selected);
    });
  }

  function grant() {
    if (!collabTarget) return;
    setCollabMessage(null);
    const [kind, id] = [collabTarget.slice(0, collabTarget.indexOf(":")), collabTarget.slice(collabTarget.indexOf(":") + 1)];
    startTransition(async () => {
      if (kind === "user") {
        const result = await grantCollabWithUser(user.id, id);
        setCollabMessage("error" in result ? result.error : `Granted 24h access to ${result.granted} client(s).`);
      } else {
        await grantTemporaryAccess(user.id, id);
      }
      setCollabTarget("");
    });
  }

  function revoke(clientId: string) {
    startTransition(async () => {
      await revokeAccess(user.id, clientId);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete ${user.email ?? "this user"}? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteUserRecord(user.id);
      setDeleted(result);
    });
  }

  const dirty = selected.length !== permanentIds.length || permanentIds.some((c) => !selected.includes(c));

  if (deleted) {
    return (
      <div className="rounded-lg border border-zinc-900 p-3 text-sm text-zinc-500">
        {user.email} deleted {deleted.fullyDeleted ? "(account fully removed)." : "(app access removed; Supabase Auth account still exists -- SUPABASE_SERVICE_ROLE_KEY isn't set, so full removal wasn't possible)."}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-900 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-100">
            {user.display_name || "—"} {isSelf && <span className="text-xs text-zinc-500">(you)</span>}
          </p>
          <p className="text-xs text-zinc-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-2">
          <span title={isSelf ? "Can't change your own role" : undefined} className={isSelf || pending ? "pointer-events-none opacity-50" : ""}>
            <Select value={role} onChange={(v) => handleRoleChange(v as Role)}>
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="client">Client</option>
            </Select>
          </span>
          {!isSelf && (
            <button onClick={handleDelete} disabled={pending} aria-label="Delete user" className="rounded p-1.5 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {role !== "admin" && (
        <div className="mt-3 flex flex-col gap-3 border-t border-zinc-900 pt-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Clients</p>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                placeholder="No clients"
                options={clients.map((c) => ({ id: c.client_id, label: c.display_name }))}
                selected={selected}
                onChange={setSelected}
              />
              <button onClick={saveAccess} disabled={!dirty || pending} className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Collab (24h)</p>
            <div className="flex flex-col gap-1.5">
              {temporary.map((t) => {
                const client = clients.find((c) => c.client_id === t.client_id);
                const hours = hoursLeft(t.expires_at!);
                return (
                  <div key={t.client_id} className="flex items-center gap-2 text-xs text-zinc-300">
                    <span className="rounded bg-status-warning/15 px-1.5 py-0.5 text-status-warning">
                      {client?.display_name ?? t.client_id} -- {hours > 0 ? `${hours}h left` : "expired"}
                    </span>
                    <button onClick={() => revoke(t.client_id)} disabled={pending} className="text-zinc-500 hover:text-status-bad">
                      revoke
                    </button>
                  </div>
                );
              })}
              {(otherUsers.length > 0 || unassignedClients.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={collabTarget} onChange={setCollabTarget}>
                    <option value="">Share access with…</option>
                    {otherUsers.length > 0 && (
                      <optgroup label="Another user's clients">
                        {otherUsers.map((u) => (
                          <option key={u.id} value={`user:${u.id}`}>{u.label}</option>
                        ))}
                      </optgroup>
                    )}
                    {unassignedClients.length > 0 && (
                      <optgroup label="A single client">
                        {unassignedClients.map((c) => (
                          <option key={c.client_id} value={`client:${c.client_id}`}>{c.display_name}</option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                  <button onClick={grant} disabled={!collabTarget || pending} className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                    Grant
                  </button>
                </div>
              )}
              {collabMessage && <p className="text-xs text-zinc-400">{collabMessage}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
