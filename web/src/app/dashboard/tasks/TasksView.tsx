"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, LayoutGrid, List, Pencil, Plus, Trash2, X } from "lucide-react";
import { notify } from "@/lib/notify";
import MultiSelect from "../_components/MultiSelect";
import Select from "../_components/Select";
import { createTask, deleteTask, setTaskStatus, updateTask, type TaskPriority, type TaskStatus } from "./actions";

export type TaskItem = {
  id: string;
  client_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
};
export type StaffUser = { id: string; name: string; role: string; clientIds: string[] };
type ClientOpt = { id: string; name: string };

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "done", label: "Done" },
];
const PRIORITY_DOT: Record<TaskPriority, string> = { high: "bg-status-bad", medium: "bg-status-warning", low: "bg-zinc-500" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dueLabel(due: string | null, status: TaskStatus): { text: string; tone: string } | null {
  if (!due) return null;
  const t = todayIso();
  const text = new Date(`${due}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (status !== "done" && due < t) return { text: `Overdue · ${text}`, tone: "text-status-bad" };
  if (due === t) return { text: "Due today", tone: "text-status-warning" };
  return { text: `Due ${text}`, tone: "text-zinc-400" };
}

export default function TasksView({
  tasks,
  clients,
  staff,
  currentUserId,
  isAdmin,
  focusTaskId,
  initialClientId,
}: {
  tasks: TaskItem[];
  clients: ClientOpt[];
  staff: StaffUser[];
  currentUserId: string;
  isAdmin: boolean;
  focusTaskId: string | null;
  initialClientId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [layout, setLayout] = useState<"board" | "list">("board");
  const [clientFilter, setClientFilter] = useState<string>(initialClientId ?? "");
  const [who, setWho] = useState<"all" | "mine" | "created">("all");
  const [showDone, setShowDone] = useState(true);
  const [editing, setEditing] = useState<TaskItem | "new" | null>(() => (focusTaskId ? (tasks.find((t) => t.id === focusTaskId) ?? null) : null));

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const staffName = useMemo(() => new Map(staff.map((s) => [s.id, s.name])), [staff]);

  const shown = useMemo(
    () =>
      tasks.filter((t) => {
        if (clientFilter && t.client_id !== clientFilter) return false;
        if (who === "mine" && t.assignee_id !== currentUserId) return false;
        if (who === "created" && t.created_by !== currentUserId) return false;
        if (!showDone && t.status === "done") return false;
        return true;
      }),
    [tasks, clientFilter, who, showDone, currentUserId]
  );

  const counts = useMemo(() => {
    const t = todayIso();
    return {
      open: tasks.filter((x) => x.status !== "done").length,
      overdue: tasks.filter((x) => x.status !== "done" && x.due_date && x.due_date < t).length,
      today: tasks.filter((x) => x.status !== "done" && x.due_date === t).length,
    };
  }, [tasks]);

  function move(task: TaskItem, status: TaskStatus) {
    startTransition(async () => {
      const r = await setTaskStatus(task.id, status);
      if ("error" in r) notify(r.error, "error");
      else router.refresh();
    });
  }

  function remove(task: TaskItem) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    startTransition(async () => {
      const r = await deleteTask(task.id);
      if ("error" in r) notify(r.error, "error");
      else {
        notify("Task deleted");
        router.refresh();
      }
    });
  }

  const canDelete = (t: TaskItem) => isAdmin || t.created_by === currentUserId;

  const card = (t: TaskItem) => {
    const due = dueLabel(t.due_date, t.status);
    const idx = COLUMNS.findIndex((c) => c.key === t.status);
    return (
      <div key={t.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 shadow-sm">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} title={`${t.priority} priority`} />
          <button onClick={() => setEditing(t)} className={`text-left text-sm font-medium hover:text-accent ${t.status === "done" ? "text-zinc-500 line-through" : "text-zinc-100"}`}>
            {t.title}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">{clientName.get(t.client_id) ?? t.client_id}</span>
          {due && <span className={due.tone}>{due.text}</span>}
          {t.assignee_id && <span className="text-zinc-400">{staffName.get(t.assignee_id) ?? "Assigned"}</span>}
        </div>
        <div className="mt-2 flex items-center gap-1 text-zinc-500">
          <button disabled={pending || idx === 0} onClick={() => move(t, COLUMNS[idx - 1].key)} aria-label="Move back" className="rounded p-1 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30">
            <ArrowLeft size={13} />
          </button>
          <button disabled={pending || idx === COLUMNS.length - 1} onClick={() => move(t, COLUMNS[idx + 1].key)} aria-label="Move forward" className="rounded p-1 hover:bg-zinc-900 hover:text-zinc-200 disabled:opacity-30">
            <ArrowRight size={13} />
          </button>
          <span className="flex-1" />
          <button onClick={() => setEditing(t)} aria-label="Edit task" className="rounded p-1 hover:bg-zinc-900 hover:text-accent">
            <Pencil size={13} />
          </button>
          {canDelete(t) && (
            <button disabled={pending} onClick={() => remove(t)} aria-label="Delete task" className="rounded p-1 hover:bg-status-bad/10 hover:text-status-bad">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl">
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
        <MultiSelect
          single
          placeholder="All clients"
          options={[{ id: "", label: "All clients" }, ...clients.map((c) => ({ id: c.id, label: c.name }))]}
          selected={clientFilter ? [clientFilter] : []}
          onChange={(ids) => setClientFilter(ids[0] ?? "")}
        />
        <div className="flex gap-1 rounded-full bg-zinc-900 p-1">
          {([
            ["all", "Everyone's"],
            ["mine", "Assigned to me"],
            ["created", "Created by me"],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setWho(k)} className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${who === k ? "bg-accent text-white" : "text-zinc-400 hover:text-zinc-100"}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
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

      {tasks.length === 0 && (
        <p className="rounded-xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-500">No tasks yet. Use New task to add the first one.</p>
      )}

      {tasks.length > 0 && layout === "board" && (
        <div className="grid gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = shown.filter((t) => t.status === col.key);
            return (
              <div key={col.key} className="rounded-xl border border-zinc-900 bg-black/30 p-3">
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

      {tasks.length > 0 && layout === "list" && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900 text-left text-xs uppercase tracking-wider text-zinc-400">
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">Client</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Assignee</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const due = dueLabel(t.due_date, t.status);
                return (
                  <tr key={t.id} className="border-b border-zinc-900 text-zinc-300 hover:bg-zinc-900/40">
                    <td className="px-3 py-1.5">
                      <button onClick={() => setEditing(t)} className={`text-left hover:text-accent ${t.status === "done" ? "text-zinc-500 line-through" : ""}`}>
                        {t.title}
                      </button>
                    </td>
                    <td className="px-3 py-1.5 text-xs">{clientName.get(t.client_id) ?? t.client_id}</td>
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
                    <td className="px-3 py-1.5 text-xs">{t.assignee_id ? (staffName.get(t.assignee_id) ?? "—") : "—"}</td>
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
                  <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
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
          task={editing === "new" ? null : editing}
          clients={clients}
          staff={staff}
          defaultClient={clientFilter || (clients.length === 1 ? clients[0].id : "")}
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

function TaskDialog({
  task,
  clients,
  staff,
  defaultClient,
  onClose,
  onSaved,
}: {
  task: TaskItem | null;
  clients: ClientOpt[];
  staff: StaffUser[];
  defaultClient: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [clientId, setClientId] = useState(task?.client_id ?? defaultClient);
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [dueDate, setDueDate] = useState(task?.due_date ?? "");
  const [assignee, setAssignee] = useState(task?.assignee_id ?? "");
  const [pending, startTransition] = useTransition();

  // Only people who work on the chosen client can be named.
  const people = staff.filter((s) => !clientId || s.clientIds.includes(clientId));

  function save() {
    startTransition(async () => {
      const r = task
        ? await updateTask(task.id, { title, description, priority, dueDate: dueDate || null, assigneeId: assignee || null })
        : await createTask({ clientId, title, description, priority, dueDate: dueDate || null, assigneeId: assignee || null });
      if ("error" in r) {
        notify(r.error, "error");
        return;
      }
      notify(task ? "Task saved" : "Task added -- the client's users were notified");
      onSaved();
    });
  }

  const input = "w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-accent focus:outline-none";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-50">{task ? "Edit task" : "New task"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-zinc-500 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Title</label>
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="What needs doing?" maxLength={200} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Client</label>
            {task ? (
              <p className="text-sm text-zinc-300">{clients.find((c) => c.id === task.client_id)?.name ?? task.client_id}</p>
            ) : (
              <MultiSelect
                single
                placeholder="Choose a client"
                options={clients.map((c) => ({ id: c.id, label: c.name }))}
                selected={clientId ? [clientId] : []}
                onChange={(ids) => {
                  setClientId(ids[0] ?? "");
                  setAssignee("");
                }}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">Details (optional)</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={input} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
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
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-400">Assign to (optional)</label>
              <MultiSelect
                single
                placeholder="Anyone on the client"
                options={[{ id: "", label: "Anyone on the client" }, ...people.map((p) => ({ id: p.id, label: p.name, hint: p.role }))]}
                selected={assignee ? [assignee] : []}
                onChange={(ids) => setAssignee(ids[0] ?? "")}
              />
            </div>
          </div>
          {!task && <p className="text-xs text-zinc-500">The users assigned to this client get a notification in the bell when the task is added.</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-600">
            Cancel
          </button>
          <button onClick={save} disabled={pending || !title.trim() || !clientId} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">
            {pending ? "Saving…" : task ? "Save" : "Add task"}
          </button>
        </div>
      </div>
    </div>
  );
}
