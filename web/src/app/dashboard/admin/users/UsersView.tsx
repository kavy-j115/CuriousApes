"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import UserRow, { type UserWithAccess } from "./UserRow";
import CreateUserForm from "./CreateUserForm";

type Client = { client_id: string; display_name: string };
type Filter = "all" | "admin" | "user";

export default function UsersView({ users, clients, currentUserId }: { users: UserWithAccess[]; clients: Client[]; currentUserId: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

  const counts = useMemo(
    () => ({ all: users.length, admin: users.filter((u) => u.role === "admin").length, user: users.filter((u) => u.role === "user").length }),
    [users]
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => (filter === "all" || u.role === filter) && (!q || `${u.display_name ?? ""} ${u.email ?? ""} ${u.phone}`.toLowerCase().includes(q)));
  }, [users, query, filter]);

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: "Everyone" },
    { key: "admin", label: "Admins" },
    { key: "user", label: "Users" },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold text-zinc-50">Users</h1>
          <span className="text-sm text-zinc-500">{counts.all} total</span>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
          {adding ? <X size={14} /> : <Plus size={14} />}
          {adding ? "Close" : "Add user"}
        </button>
      </div>

      {adding && <CreateUserForm clients={clients} />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <Search size={14} className="text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email or phone"
            className="w-64 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
          {pills.map((p) => (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${filter === p.key ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-100"}`}
            >
              {p.label} <span className="opacity-70">{counts[p.key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div data-tour="user-list" className="flex flex-col gap-3">
        {shown.map((u) => (
          <UserRow key={u.id} user={u} clients={clients} currentUserId={currentUserId} />
        ))}
        {shown.length === 0 && (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            {users.length === 0 ? "No users yet." : "No users match."}
          </p>
        )}
      </div>
    </div>
  );
}
