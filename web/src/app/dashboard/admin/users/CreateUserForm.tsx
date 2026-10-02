"use client";

import { useActionState, useState } from "react";
import { createUser } from "../actions";
import Select from "../../_components/Select";
import Checkbox from "../../_components/Checkbox";

type Client = { client_id: string; display_name: string };
type ActionState = { email: string; tempPassword: string } | { error: string } | null;

const inputClass =
  "rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none";

export default function CreateUserForm({ clients }: { clients: Client[] }) {
  const [role, setRole] = useState("user");
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  function toggleAssigned(id: string) {
    setAssigned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (_prev, formData) => {
    try {
      return await createUser(formData);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to create user." };
    }
  }, null);

  return (
    <div className="mb-8 rounded-lg border border-zinc-800 p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-200">Create a user</p>

      {state && "tempPassword" in state && (
        <div className="mb-4 rounded border border-status-good/30 bg-status-good/10 p-3 text-sm text-status-good">
          <p className="font-medium">Account created for {state.email}.</p>
          <p className="mt-1">
            Temporary password: <span className="font-mono">{state.tempPassword}</span>
          </p>
        </div>
      )}
      {state && "error" in state && (
        <p className="mb-4 rounded border border-status-bad/30 bg-status-bad/10 p-3 text-sm text-status-bad">{state.error}</p>
      )}

      <form action={formAction} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Display name</label>
            <input name="display_name" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Role</label>
            <Select name="role" value={role} onChange={setRole} className="[&_select]:py-2">
              <option value="admin">Admin</option>
              <option value="user">User</option>
              <option value="client">Client</option>
            </Select>
          </div>
        </div>

        {role === "client" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Client</label>
            {clients.length > 0 ? (
              <Select name="client_ids" required className="[&_select]:py-2">
                {clients.map((c) => (
                  <option key={c.client_id} value={c.client_id}>{c.display_name}</option>
                ))}
              </Select>
            ) : (
              <p className="text-xs text-zinc-500">No clients exist yet -- add one first.</p>
            )}
          </div>
        )}

        {role === "user" && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Assigned clients</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {clients.map((c) => (
                <Checkbox
                  key={c.client_id}
                  name="client_ids"
                  value={c.client_id}
                  checked={assigned.has(c.client_id)}
                  onChange={() => toggleAssigned(c.client_id)}
                  label={c.display_name}
                />
              ))}
              {clients.length === 0 && <p className="text-xs text-zinc-500">No clients exist yet -- add one first.</p>}
            </div>
          </div>
        )}

        <button type="submit" disabled={pending} className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create user"}
        </button>
      </form>
    </div>
  );
}
