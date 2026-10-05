"use client";

import { useActionState, useEffect, useState } from "react";
import { notify } from "@/lib/notify";
import { createUser } from "../actions";
import Select from "../../_components/Select";
import MultiSelect from "../../_components/MultiSelect";

type Client = { client_id: string; display_name: string };
type ActionState = { email: string; tempPassword: string } | { error: string } | null;

const inputClass =
  "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none";

export default function CreateUserForm({ clients }: { clients: Client[] }) {
  const [role, setRole] = useState("user");
  const [assigned, setAssigned] = useState<string[]>([]);
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (_prev, formData) => {
    try {
      return await createUser(formData);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Failed to create user." };
    }
  }, null);

  useEffect(() => {
    if (state && "email" in state) notify("User created");
    else if (state && "error" in state) notify(state.error, "error");
  }, [state]);

  return (
    <div data-tour="user-create" className="mb-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
      <p className="mb-4 text-sm font-semibold text-zinc-100">New user</p>

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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Email</label>
            <input name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Display name</label>
            <input name="display_name" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">WhatsApp number</label>
            <input name="phone" type="tel" placeholder="+919876543210" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Role</label>
            <Select name="role" value={role} onChange={setRole} className="[&_select]:py-2">
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </Select>
          </div>
        </div>

        {role === "user" && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-zinc-400">Assigned clients</p>
            <MultiSelect
              unit="client"
              placeholder={clients.length === 0 ? "No clients yet" : "Select clients"}
              options={clients.map((c) => ({ id: c.client_id, label: c.display_name }))}
              selected={assigned}
              onChange={setAssigned}
            />
            {assigned.map((id) => (
              <input key={id} type="hidden" name="client_ids" value={id} />
            ))}
          </div>
        )}

        <button type="submit" disabled={pending} className="self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Creating…" : "Create user"}
        </button>
      </form>
    </div>
  );
}
