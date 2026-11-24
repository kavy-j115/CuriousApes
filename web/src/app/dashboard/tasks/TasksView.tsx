"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, LayoutGrid, List, MessageSquare, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { notify } from "@/lib/notify";
import { TEAMS, TEAM_LABEL } from "@/lib/teams";
import MultiSelect from "../_components/MultiSelect";
import Select from "../_components/Select";
import {
  addTaskComment,
  createTask,
  deleteTask,
  getTaskComments,
  setTaskStatus,
  updateTask,
  type TaskComment,
  type TaskPriority,
  type TaskStatus,
} from "./actions";

export type TaskItem = {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  team: string | null;
  link: string | null;
  assignee_ids: string[];
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};
export type StaffUser = { id: string; name: string; team: string | null; clientIds: string[] };
type ClientOpt = { id: string; name: string };

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "In review" },
  { key: "done", label: "Done" },
];
const PRIORITY_DOT: Record<TaskPriority, string> = { high: "bg-status-bad", medium: "bg-status-warning", low: "bg-zinc-500" };
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

function dueLabel(due: string | null, status: TaskStatus, today: string): { text: string; tone: string } | null {
  if (!due) return null;
  const text = new Date(`${due}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (status !== "done" && due < today) return { text: `Overdue · ${text}`, tone: "text-status-bad" };
  if (due === today) return { text: "Due today", tone: "text-status-warning" };
  return { text: `Due ${text}`, tone: "text-zinc-400" };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

// Open work first: soonest due date, then priority; tasks without a date go last.
function byUrgency(a: TaskItem, b: TaskItem) {
  if (a.due_date !== b.due_date) return !a.due_date ? 1 : !b.due_date ? -1 : a.due_date < b.due_date ? -1 : 1;
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

export default function TasksView({
  tasks,
  clients,
  clientNames,
  staff,
  currentUserId,
  isAdmin,
  focusTaskId,
  initialClientId,
  today,
}: {
  tasks: TaskItem[];
  clients: ClientOpt[];
  clientNames: Record<string, string>;
  staff: StaffUser[];
  currentUserId: string;
  isAdmin: boolean;
  focusTaskId: string | null;
  initialClientId: string | null;
  today: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // The board shows this local copy so a move feels instant; it follows the server's list
  // whenever a fresh one arrives (after adding, editing or deleting).
  const [local, setLocal] = useState(tasks);
  useEffect(() => setLocal(tasks), [tasks]);

  const [layout, setLayout] = useState<"board" | "list">("board");
  const [clientFilter, setClientFilter] = useState<string>(initialClientId ?? "");
  const [teamFilter, setTeamFilter] = useState("");
  const [who, setWho] = useState<"all" | "mine" | "unassigned" | "created">("all");
  const [showDone, setShowDone] = useState(true);
  const [query, setQuery] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const [editing, setEditing] = useState<TaskItem | "new" | null>(() => (focusTaskId ? (tasks.find((t) => t.id === focusTaskId) ?? null) : null));

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return local
      .filter((t) => {
        if (clientFilter && t.client_id !== clientFilter) return false;
        if (teamFilter && t.team !== teamFilter) return false;
        if (who === "mine" && !t.assignee_ids.includes(currentUserId)) return false;
        if (who === "unassigned" && t.assignee_ids.length > 0) return false;
        if (who === "created" && t.created_by !== currentUserId) return false;
        if (!showDone && t.status === "done") return false;
        if (q && !`${t.title} ${t.description ?? ""} ${clientNames[t.client_id] ?? ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort(byUrgency);
  }, [local, clientFilter, teamFilter, who, showDone, query, currentUserId, clientNames]);

  const counts = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let dueToday = 0;
    for (const t of local) {
      if (t.status === "done") continue;
      open++;
      if (t.due_date && t.due_date < today) overdue++;
      else if (t.due_date === today) dueToday++;
    }
    return { open, overdue, today: dueToday };
  }, [local, today]);

  function move(task: TaskItem, status: TaskStatus) {
    if (task.status === status) return;
    const previous = task.status;
    const patch = (s: TaskStatus) => setLocal((list) => list.map((t) => (t.id === task.id ? { ...t, status: s, completed_at: s === "done" ? new Date().toISOString() : null } : t)));
    patch(status);
    startTransition(async () => {
      const r = await setTaskStatus(task.id, status);
      if ("error" in r) {
        patch(previous);
        notify(r.error, "error");
      }
    });
  }

  function remove(task: TaskItem) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setLocal((list) => list.filter((t) => t.id !== task.id));
    startTransition(async () => {
      const r = await deleteTask(task.id);
      if ("error" in r) {
        notify(r.error, "error");
        router.refresh();
      } else notify("Task deleted");
    });
  }

  const canDelete = (t: TaskItem) => isAdmin || t.created_by === currentUserId;

  function assigneeChips(t: TaskItem) {
    if (t.assignee_ids.length === 0) return null;
    return (
      <span className="flex -space-x-1.5">
        {t.assignee_ids.slice(0, 3).map((id) => {
          const name = staffById.get(id)?.name ?? "Teammate";
          return (
            <span key={id} title={name} className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-950 bg-accent/20 text-[9px] font-semibold text-accent">
              {initials(name)}
            </span>
          );
        })}
        {t.assignee_ids.length > 3 && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-zinc-950 bg-zinc-800 text-[9px] text-zinc-300">+{t.assignee_ids.length - 3}</span>
        )}
      </span>
    );
  }

  const card = (t: TaskItem) => {
    const due = dueLabel(t.due_date, t.status, today);
    return (
      <div
        key={t.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", t.id);
          e.dataTransfer.effectAllowed = "move";
          setDragId(t.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setOverCol(null);
        }}
        className={`cursor-grab rounded-lg border border-zinc-800 bg-zinc-950 p-3 shadow-sm active:cursor-grabbing ${dragId === t.id ? "opacity-40" : ""}`}
      >
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} title={`${t.priority} priority`} />
          <button onClick={() => setEditing(t)} className={`text-left text-sm font-medium hover:text-accent ${t.status === "done" ? "text-zinc-500 line-through" : "text-zinc-100"}`}>
            {t.title}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{clientNames[t.client_id] ?? t.client_id}</span>
          {t.team && <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{TEAM_LABEL[t.team] ?? t.team}</span>}
          {due && <span className={due.tone}>{due.text}</span>}
        </div>
        <div className="mt-2 flex items-center gap-1 text-zinc-500">
          {assigneeChips(t)}
          <span className="flex-1" />
          {t.link && (
            <a href={t.link} target="_blank" rel="noopener noreferrer" aria-label="Open link" className="rounded p-1 hover:bg-zinc-900 hover:text-accent">
              <ExternalLink size={13} />
            </a>
          )}
          <button onClick={() => setEditing(t)} aria-label="Open task" className="rounded p-1 hover:bg-zinc-900 hover:text-accent">
            <Pencil size={13} />
          </button>
          {canDelete(t) && (
            <button onClick={() => remove(t)} aria-label="Delete task" className="rounded p-1 hover:bg-status-bad/10 hover:text-status-bad">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  const pill = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-100"}`;

  return (
    <div className="max-w-[90rem]">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold text-zinc-50">Tasks</h1>
          <span className="text-sm text-zinc-500">
            {counts.open} open
            {counts.overdue > 0 && <span className="text-status-bad"> · {counts.overdue} overdue</span>}
            {counts.today > 0 && <span className="text-status-warning"> · {counts.today} due today</span>}
          </span>
        </div>
        <button onClick={() => setEditing("new")} className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">
          <Plus size={14} /> New task
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks"
            className="w-48 rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-zinc-100 focus:border-accent focus:outline-none"
          />
        </div>
        <MultiSelect
          single
          placeholder="All clients"
          options={[{ id: "", label: "All clients" }, ...clients.map((c) => ({ id: c.id, label: c.name }))]}
          selected={clientFilter ? [clientFilter] : []}
          onChange={(ids) => setClientFilter(ids[0] ?? "")}
        />
        <Select value={teamFilter} onChange={setTeamFilter}>
          <option value="">All teams</option>
          {TEAMS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </Select>
        <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
          {([
            ["all", "Everyone's"],
            ["mine", "Mine"],
            ["unassigned", "Unassigned"],
            ["created", "Created by me"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setWho(k)} className={pill(who === k)}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done (last 30 days)
        </label>
        <div className="ml-auto flex gap-1 rounded-md border border-zinc-800 p-0.5">
          <button onClick={() => setLayout("board")} aria-label="Board" className={`rounded p-1.5 ${layout === "board" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}>
            <LayoutGrid size={14} />
          </button>
          <button onClick={() => setLayout("list")} aria-label="List" className={`rounded p-1.5 ${layout === "list" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500"}`}>
            <List size={14} />
          </button>
        </div>
      </div>

      {local.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">No tasks yet. Use New task to add the first one.</p>
      )}

      {local.length > 0 && layout === "board" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const list = shown.filter((t) => t.status === col.key);
            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (overCol !== col.key) setOverCol(col.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverCol(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  const t = local.find((x) => x.id === id);
                  setOverCol(null);
                  setDragId(null);
                  if (t) move(t, col.key);
                }}
                className={`rounded-xl border p-3 transition-colors ${overCol === col.key ? "border-accent bg-accent/5" : "border-zinc-900 bg-black/30"}`}
              >
                <p className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {col.label}
                  <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">{list.length}</span>
                </p>
                <div className="flex flex-col gap-2">
                  {list.map(card)}
                  {list.length === 0 && <p className="py-4 text-center text-xs text-zinc-600">Nothing here</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {local.length > 0 && layout === "list" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Team</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Assigned to</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const due = dueLabel(t.due_date, t.status, today);
                return (
                  <tr key={t.id} className="border-b border-zinc-900 text-zinc-300 hover:bg-zinc-900/40">
                    <td className="px-3 py-1.5">
                      <button onClick={() => setEditing(t)} className={`text-left hover:text-accent ${t.status === "done" ? "text-zinc-500 line-through" : ""}`}>
                        {t.title}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-xs">{clientNames[t.client_id] ?? t.client_id}</td>
                    <td className="px-3 py-1.5 text-xs">{t.team ? (TEAM_LABEL[t.team] ?? t.team) : "—"}</td>
                    <td className="px-3 py-1.5">
                      <Select value={t.status} onChange={(v) => move(t, v as TaskStatus)}>
                        {COLUMNS.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-3 py-1.5 text-xs capitalize">
                      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${PRIORITY_DOT[t.priority]}`} />
                      {t.priority}
                    </td>
                    <td className={`px-3 py-1.5 text-xs ${due?.tone ?? "text-zinc-500"}`}>{due?.text ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {t.assignee_ids.length ? t.assignee_ids.map((id) => staffById.get(id)?.name ?? "Teammate").join(", ") : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {canDelete(t) && (
                        <button onClick={() => remove(t)} aria-label="Delete task" className="rounded p-1 text-zinc-500 hover:bg-status-bad/10 hover:text-status-bad">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                    No tasks match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <TaskDialog
          // Remount for a different task so the form never shows the previous one's values.
          key={editing === "new" ? "new" : editing.id}
          task={editing === "new" ? null : editing}
          clients={clients}
          clientNames={clientNames}
          staff={staff}
          defaultClient={clientFilter || (clients.length === 1 ? clients[0].id : "")}
          defaultTeam={teamFilter}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function TaskDialog({
  task,
  clients,
  clientNames,
  staff,
  defaultClient,
  defaultTeam,
  onClose,
  onSaved,
}: {
  task: TaskItem | null;
  clients: ClientOpt[];
  clientNames: Record<string, string>;
  staff: StaffUser[];
  defaultClient: string;
  defaultTeam: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [clientId, setClientId] = useState(task?.client_id ?? defaultClient);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [team, setTeam] = useState(task?.team ?? defaultTeam);
  const [link, setLink] = useState(task?.link ?? "");
  const [assignees, setAssignees] = useState<string[]>(task?.assignee_ids ?? []);
  const [pending, startTransition] = useTransition();

  // Anyone on the agency's user list can be named (a designer or editor often serves many
  // brands). People in the task's team come first, then people already on the client.
  const people = useMemo(() => {
    const rank = (s: StaffUser) => (team && s.team === team ? 0 : clientId && s.clientIds.includes(clientId) ? 1 : 2);
    return [...staff].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [staff, team, clientId]);

  function save() {
    startTransition(async () => {
      const common = { title, description, priority, dueDate: dueDate || null, team: team || null, link: link || null, assigneeIds: assignees };
      const r = task ? await updateTask(task.id, common) : await createTask({ clientId, ...common });
      if ("error" in r) {
        notify(r.error, "error");
        return;
      }
      notify(task ? "Task saved" : assignees.length ? "Task added -- the people named were notified" : "Task added");
      onSaved();
    });
  }

  const input = "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-50">{task ? "Task" : "New task"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Title</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="What needs doing?" maxLength={200} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Client</label>
              {task ? (
                <p className="py-2 text-sm text-zinc-300">{clientNames[task.client_id] ?? task.client_id}</p>
              ) : (
                <MultiSelect
                  single
                  placeholder="Choose a client"
                  options={clients.map((c) => ({ id: c.id, label: c.name }))}
                  selected={clientId ? [clientId] : []}
                  onChange={(ids) => setClientId(ids[0] ?? "")}
                />
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Team</label>
              <Select value={team} onChange={setTeam} className="w-full">
                <option value="">Any team</option>
                {TEAMS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Details (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={input} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Priority</label>
              <Select value={priority} onChange={(v) => setPriority(v as TaskPriority)} className="w-full">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Assign to (one or more)</label>
            <MultiSelect
              unit="person"
              placeholder="Nobody yet"
              options={people.map((p) => ({ id: p.id, label: p.name, hint: p.team ? (TEAM_LABEL[p.team] ?? p.team) : undefined }))}
              selected={assignees}
              onChange={setAssignees}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Link (brief, files or finished work)</label>
            <input value={link} onChange={(e) => setLink(e.target.value)} className={input} placeholder="https://drive.google.com/…" maxLength={1000} />
          </div>
          {!task && (
            <p className="text-xs text-zinc-500">
              {assignees.length ? "The people named get a notification in the bell." : "With nobody named, the client's users (in the chosen team, if any) get a notification."}
            </p>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600">
            Cancel
          </button>
          <button onClick={save} disabled={pending || !title.trim() || !clientId} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {pending ? "Saving…" : task ? "Save" : "Add task"}
          </button>
        </div>
        {task && <Comments taskId={task.id} />}
      </div>
    </div>
  );
}

// Loaded only when a task is opened, so the board itself never pays for comments.
function Comments({ taskId }: { taskId: string }) {
  const [items, setItems] = useState<TaskComment[] | null>(null);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    getTaskComments(taskId)
      .then((c) => live && setItems(c))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [taskId]);

  function send() {
    const body = text.trim();
    if (!body) return;
    startTransition(async () => {
      const r = await addTaskComment(taskId, body);
      if ("error" in r) {
        notify(r.error, "error");
        return;
      }
      setText("");
      setItems(await getTaskComments(taskId));
      endRef.current?.scrollIntoView({ block: "nearest" });
    });
  }

  return (
    <div className="mt-5 border-t border-zinc-900 pt-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
        <MessageSquare size={13} /> Comments
      </p>
      <div className="mb-3 flex max-h-56 flex-col gap-2 overflow-y-auto">
        {items === null && <p className="text-xs text-zinc-600">Loading…</p>}
        {items?.length === 0 && <p className="text-xs text-zinc-600">No comments yet.</p>}
        {items?.map((c) => (
          <div key={c.id} className="rounded-md bg-zinc-900/60 px-3 py-2">
            <p className="text-xs text-zinc-500">
              <span className="font-medium text-zinc-300">{c.mine ? "You" : c.author}</span> · {ago(c.created_at)}
            </p>
            <p className="whitespace-pre-wrap text-sm text-zinc-200">{c.body}</p>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={2000}
          placeholder="Write a comment…"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none"
        />
        <button onClick={send} disabled={pending || !text.trim()} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          Send
        </button>
      </div>
    </div>
  );
}
