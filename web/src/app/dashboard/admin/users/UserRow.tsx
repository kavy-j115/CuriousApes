"use client";

import { notify, withToast } from "@/lib/notify";
import { memo, useState, useTransition } from "react";
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import {
  updateUserRole,
  updateUserPhone,
  resetUserPassword,
  setUserClientAccess,
  grantTemporaryAccess,
  revokeAccess,
  deleteUserRecord,
} from "../actions";
import Select from "../../_components/Select";
import MultiSelect from "../../_components/MultiSelect";
import type { Role } from "@/lib/auth/profile";

type Client = { client_id: string; display_name: string };
type AccessRow = { client_id: string; expires_at: string | null };
export type UserWithAccess = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  phone: string;
  access: AccessRow[];
};

function hoursLeft(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000));
}

function UserRow({
  user,
  clients,
  currentUserId,
}: {
  user: UserWithAccess;
  clients: Client[];
  currentUserId: string;
}) {
  const [role, setRole] = useState<Role>(user.role);
  const permanentIds = user.access.filter((a) => !a.expires_at).map((a) => a.client_id);
  const temporary = user.access.filter((a) => a.expires_at);
  const [selected, setSelected] = useState<string[]>(permanentIds);
  const [collabClient, setCollabClient] = useState("");
  const [phone, setPhone] = useState(user.phone);
  const [editingPhone, setEditingPhone] = useState(false);
  const [pendingAdmin, setPendingAdmin] = useState<{ kind: "role"; role: Role } | { kind: "delete" } | null>(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [newPassword, setNewPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [accessOpen, setAccessOpen] = useState(false);
  const [deleted, setDeleted] = useState<{ fullyDeleted: boolean } | null>(null);
  const isSelf = user.id === currentUserId;

  const unassignedClients = clients.filter(
    (c) => !permanentIds.includes(c.client_id) && !temporary.some((t) => t.client_id === c.client_id)
  );

  function handleRoleChange(newRole: Role) {
    // Anything that involves the admin role needs an admin password first.
    if (user.role === "admin" || newRole === "admin") {
      setAdminPassword("");
      setPendingAdmin({ kind: "role", role: newRole });
      return;
    }
    setRole(newRole);
    startTransition(async () => {
      await withToast(() => updateUserRole(user.id, newRole), "Role updated");
    });
  }

  function confirmAdminAction() {
    if (!pendingAdmin) return;
    startTransition(async () => {
      try {
        if (pendingAdmin.kind === "role") {
          await updateUserRole(user.id, pendingAdmin.role, adminPassword);
          setRole(pendingAdmin.role);
          notify("Role updated");
        } else {
          const result = await deleteUserRecord(user.id, adminPassword);
          setDeleted(result);
          notify("User deleted");
        }
        setPendingAdmin(null);
        setAdminPassword("");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't confirm that.", "error");
      }
    });
  }

  function saveAccess() {
    startTransition(async () => {
      await withToast(() => setUserClientAccess(user.id, selected), "Access saved");
    });
  }

  function grant() {
    if (!collabClient) return;
    startTransition(async () => {
      await withToast(() => grantTemporaryAccess(user.id, collabClient), "Access granted for 24 hours");
      setCollabClient("");
    });
  }

  function savePhone() {
    startTransition(async () => {
      try {
        await updateUserPhone(user.id, phone);
        notify("WhatsApp number saved");
        setEditingPhone(false);
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't save the number.", "error");
      }
    });
  }

  function handleResetPassword() {
    if (!confirm(`Reset the password for ${user.email ?? "this user"}? They will have to choose a new one at next login.`)) return;
    startTransition(async () => {
      try {
        const { tempPassword } = await resetUserPassword(user.id);
        setNewPassword(tempPassword);
        notify("Password reset");
      } catch (e) {
        notify(e instanceof Error ? e.message : "Couldn't reset the password.", "error");
      }
    });
  }

  function cancelPhone() {
    setPhone(user.phone);
    setEditingPhone(false);
  }

  function revoke(clientId: string) {
    startTransition(async () => {
      await withToast(() => revokeAccess(user.id, clientId), "Access ended");
    });
  }

  function handleDelete() {
    if (user.role === "admin") {
      setAdminPassword("");
      setPendingAdmin({ kind: "delete" });
      return;
    }
    if (!confirm(`Delete ${user.email ?? "this user"}? This can't be undone.`)) return;
    startTransition(async () => {
      const result = await deleteUserRecord(user.id);
      setDeleted(result);
      notify("User deleted");
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
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-sm font-semibold text-accent">
            {(user.display_name || user.email || "?").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-50">
              {user.display_name || "—"} {isSelf && <span className="text-xs font-normal text-zinc-500">(you)</span>}
            </p>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${role === "admin" ? "bg-status-warning/15 text-status-warning" : "bg-accent/15 text-accent"}`}>
              {role === "admin" ? "Admin" : "User"}
            </span>
          </div>
          <p className="text-xs text-zinc-500">{user.email}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            {editingPhone ? (
              <>
                <input
                  type="tel"
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") savePhone();
                    if (e.key === "Escape") cancelPhone();
                  }}
                  placeholder="+919876543210"
                  className="w-40 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-accent focus:outline-none"
                />
                <button onClick={savePhone} disabled={pending} className="rounded bg-accent px-2 py-1 font-medium text-white disabled:opacity-40">
                  Save
                </button>
                <button onClick={cancelPhone} className="text-zinc-500 hover:text-zinc-300">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span className={user.phone ? "text-zinc-400" : "text-zinc-600"}>{user.phone || "No WhatsApp number"}</span>
                <button onClick={() => setEditingPhone(true)} aria-label="Edit WhatsApp number" title="Edit WhatsApp number" className="rounded p-1 text-zinc-500 hover:bg-zinc-900 hover:text-accent">
                  <Pencil size={12} />
                </button>
              </>
            )}
          </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span title={isSelf ? "Can't change your own role" : undefined} className={isSelf || pending ? "pointer-events-none opacity-50" : ""}>
            <Select value={role} onChange={(v) => handleRoleChange(v as Role)}>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </Select>
          </span>
          {!isSelf && (
            <button onClick={handleResetPassword} disabled={pending} aria-label="Reset password" title="Reset password" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-accent">
              <KeyRound size={14} />
            </button>
          )}
          {!isSelf && (
            <button onClick={handleDelete} disabled={pending} aria-label="Delete user" className="rounded p-1.5 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {pendingAdmin && (
        <div className="mx-4 mb-4 rounded-lg border border-status-warning/40 bg-status-warning/10 p-3">
          <p className="text-sm font-medium text-status-warning">
            {pendingAdmin.kind === "delete"
              ? `Delete the admin ${user.email ?? ""}?`
              : pendingAdmin.role === "admin"
                ? `Make ${user.email ?? "this user"} an admin?`
                : `Remove admin rights from ${user.email ?? "this admin"}?`}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">This needs an admin password. Enter the password of any admin account to confirm.</p>
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              confirmAdminAction();
            }}
          >
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Admin password"
              className="w-56 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-accent focus:outline-none"
            />
            <button type="submit" disabled={pending || !adminPassword} className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {pending ? "Checking…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingAdmin(null);
                setAdminPassword("");
              }}
              className="text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {newPassword && (
        <div className="mx-4 mb-4 flex flex-wrap items-center gap-2 rounded border border-status-good/30 bg-status-good/10 p-2.5 text-xs text-status-good">
          <span>
            Temporary password: <span className="font-mono">{newPassword}</span>
          </span>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(newPassword);
              notify("Password copied");
            }}
            className="rounded border border-status-good/40 px-2 py-0.5 hover:bg-status-good/10"
          >
            Copy
          </button>
          <button onClick={() => setNewPassword(null)} className="ml-auto text-zinc-500 hover:text-zinc-300">
            Hide
          </button>
        </div>
      )}

      {role !== "admin" && (
        <div className="border-t border-zinc-900 px-4 py-2">
          <button
            onClick={() => setAccessOpen((v) => !v)}
            aria-expanded={accessOpen}
            className={`text-xs font-medium ${accessOpen ? "text-accent" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            Access ({permanentIds.length}{temporary.length ? ` + ${temporary.length} collab` : ""})
          </button>
        </div>
      )}

      {role !== "admin" && accessOpen && (
        <div className="flex flex-col gap-4 border-t border-zinc-900 bg-black/30 p-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Clients</p>
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                unit="client"
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

          {/* Collab is only shown when one is active or one could be granted (a client left to give). */}
          {role === "user" && (temporary.length > 0 || unassignedClients.length > 0) && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Collab (24h)</p>
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
                {unassignedClients.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <MultiSelect
                      single
                      placeholder="Choose a client…"
                      options={unassignedClients.map((c) => ({ id: c.client_id, label: c.display_name }))}
                      selected={collabClient ? [collabClient] : []}
                      onChange={(ids) => setCollabClient(ids[0] ?? "")}
                    />
                    <button onClick={grant} disabled={!collabClient || pending} className="rounded bg-accent px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                      Grant 24h
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Skip re-rendering every card when only one row (or the search box) changes.
export default memo(UserRow);
