"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";
import { isTeam } from "@/lib/teams";

// Tasks are plain rows read and written with the logged-in user's own session, so the
// row-level rules in sql/038 and sql/042 decide who can see or change what (agency staff,
// for the clients they can access, plus anyone named on the task). The service role is used
// only for what the user's session cannot do: the assignee and comment rows (writes are
// allowed only after the user's own session has proved it can see the task) and the
// notification rows, which are addressed to OTHER users.

export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type TaskInput = {
  clientId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeIds?: string[];
  team?: string | null;
  link?: string | null;
};
type Result = { ok: true } | { error: string };

const STATUSES: TaskStatus[] = ["todo", "in_progress", "review", "done"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ASSIGNEES = 20;

async function requireStaff() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile || (profile.role !== "admin" && profile.role !== "user")) throw new Error("Tasks are for agency staff only.");
  return { supabase, profile, who: profile.display_name || profile.email || "a teammate" };
}

function clean(input: Partial<TaskInput>) {
  const out: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const t = input.title.trim();
    if (!t) throw new Error("A task needs a title.");
    if (t.length > 200) throw new Error("The title is too long (200 characters at most).");
    out.title = t;
  }
  if (input.description !== undefined) out.description = input.description.trim().slice(0, 4000) || null;
  if (input.priority !== undefined) {
    if (!["low", "medium", "high"].includes(input.priority)) throw new Error("Unknown priority.");
    out.priority = input.priority;
  }
  if (input.dueDate !== undefined) {
    if (input.dueDate && !DATE_RE.test(input.dueDate)) throw new Error("Pick a valid due date.");
    out.due_date = input.dueDate || null;
  }
  if (input.team !== undefined) {
    if (input.team && !isTeam(input.team)) throw new Error("Unknown team.");
    out.team = input.team || null;
  }
  if (input.link !== undefined) {
    const l = (input.link ?? "").trim();
    if (l && !/^https?:\/\/\S+$/i.test(l)) throw new Error("The link must start with http:// or https://.");
    out.link = l.slice(0, 1000) || null;
  }
  return out;
}

// A task can only be given to a user (not an admin -- admins hand tasks out -- or a client).
async function assertAssignable(ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return [];
  if (unique.length > MAX_ASSIGNEES) throw new Error(`At most ${MAX_ASSIGNEES} people can be named on one task.`);
  const { data } = await getAdminClient().from("user_profiles").select("id").in("id", unique).eq("role", "user");
  if ((data?.length ?? 0) !== unique.length) throw new Error("Tasks can only be assigned to users.");
  return unique;
}

// Replaces a task's assignees with `ids` and returns the people newly added.
async function syncAssignees(taskId: string, ids: string[]): Promise<string[]> {
  const admin = getAdminClient();
  const { data: current } = await admin.from("task_assignees").select("user_id").eq("task_id", taskId);
  const have = new Set((current ?? []).map((r) => r.user_id as string));
  const want = new Set(ids);
  const added = ids.filter((id) => !have.has(id));
  const removed = [...have].filter((id) => !want.has(id));
  await Promise.all([
    added.length ? admin.from("task_assignees").insert(added.map((user_id) => ({ task_id: taskId, user_id }))) : null,
    removed.length ? admin.from("task_assignees").delete().eq("task_id", taskId).in("user_id", removed) : null,
  ]);
  return added;
}

// With nobody named, the people on the client hear about it -- narrowed to the task's team
// when it has one, so a video brief doesn't ping every performance marketer.
async function clientAudience(clientId: string, team: string | null): Promise<string[]> {
  const admin = getAdminClient();
  const { data: access } = await admin.from("client_access").select("user_id, expires_at").eq("client_id", clientId);
  const now = Date.now();
  const ids = [...new Set((access ?? []).filter((a) => !a.expires_at || new Date(a.expires_at as string).getTime() > now).map((a) => a.user_id as string))];
  if (ids.length === 0) return [];
  let q = admin.from("user_profiles").select("id").in("id", ids).eq("role", "user");
  if (team) q = q.eq("team", team);
  const { data } = await q;
  return (data ?? []).map((s) => s.id as string);
}

async function notify(
  task: { id: string; client_id: string; title: string; due_date: string | null },
  recipients: string[],
  actorId: string,
  text: string,
  kind = "task"
) {
  const to = [...new Set(recipients)].filter((id) => id !== actorId);
  if (to.length === 0) return;
  const admin = getAdminClient();
  const { data: client } = await admin.from("clients").select("display_name").eq("client_id", task.client_id).maybeSingle();
  const clientName = (client?.display_name as string | undefined) ?? task.client_id;
  const body = `${clientName}${task.due_date ? ` · due ${task.due_date}` : ""} · ${text}`;
  await admin.from("notifications").insert(
    to.map((user_id) => ({ user_id, kind, title: task.title, body, link: `/dashboard/tasks?task=${task.id}`, task_id: task.id }))
  );
}

const TASK_COLS = "id, client_id, title, due_date, team, created_by";

export async function createTask(input: TaskInput): Promise<Result> {
  try {
    const { supabase, profile, who } = await requireStaff();
    if (!input.clientId) return { error: "Choose a client for the task." };
    const fields = clean({ ...input, title: input.title ?? "" });
    const assignees = await assertAssignable(input.assigneeIds);
    const { data, error } = await supabase
      .from("tasks")
      .insert({ client_id: input.clientId, created_by: profile.id, ...fields })
      .select(TASK_COLS)
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't create the task." };

    const task = data as { id: string; client_id: string; title: string; due_date: string | null; team: string | null };
    let recipients = assignees;
    if (assignees.length) await syncAssignees(task.id, assignees);
    else recipients = await clientAudience(task.client_id, task.team);
    await notify(task, recipients, profile.id, assignees.length ? `assigned to you by ${who}` : `added by ${who}`);
    revalidatePath("/dashboard/tasks");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create the task." };
  }
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<Result> {
  try {
    const { supabase, profile, who } = await requireStaff();
    const fields = clean(input);
    const assignees = input.assigneeIds === undefined ? null : await assertAssignable(input.assigneeIds);
    const { data, error } = await supabase
      .from("tasks")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(TASK_COLS)
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't save the task." };
    if (assignees) {
      const added = await syncAssignees(id, assignees);
      await notify(data as { id: string; client_id: string; title: string; due_date: string | null }, added, profile.id, `assigned to you by ${who}`);
    }
    revalidatePath("/dashboard/tasks");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the task." };
  }
}

// The common move (drag or arrow). No page revalidation: the board already shows the new
// state, so the client doesn't need to re-fetch everything for one card.
export async function setTaskStatus(id: string, status: TaskStatus): Promise<Result> {
  try {
    const { supabase, profile, who } = await requireStaff();
    if (!STATUSES.includes(status)) return { error: "Unknown status." };
    const { data, error } = await supabase
      .from("tasks")
      .update({ status, completed_at: status === "done" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(TASK_COLS)
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't move the task." };
    // The person who asked for the work hears when it is ready for review or finished.
    if ((status === "review" || status === "done") && data.created_by) {
      await notify(
        data as { id: string; client_id: string; title: string; due_date: string | null },
        [data.created_by as string],
        profile.id,
        status === "review" ? `ready for review (${who})` : `marked done by ${who}`
      );
    }
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't move the task." };
  }
}

export async function deleteTask(id: string): Promise<Result> {
  try {
    const { supabase } = await requireStaff();
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/dashboard/tasks");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't delete the task." };
  }
}

// ---- Comments ----

export type TaskComment = { id: string; body: string; created_at: string; author: string; mine: boolean };

export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
  const { supabase, profile } = await requireStaff();
  const { data } = await supabase.from("task_comments").select("id, body, created_at, user_id").eq("task_id", taskId).order("created_at").limit(200);
  const rows = data ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id as string | null).filter((x): x is string => !!x))];
  const { data: people } = ids.length ? await getAdminClient().from("user_profiles").select("id, display_name, email").in("id", ids) : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, (p.display_name as string | null) || (p.email as string | null) || "Teammate"]));
  return rows.map((r) => ({
    id: r.id as string,
    body: r.body as string,
    created_at: r.created_at as string,
    author: r.user_id ? (names.get(r.user_id as string) ?? "Teammate") : "Former teammate",
    mine: r.user_id === profile.id,
  }));
}

export async function addTaskComment(taskId: string, body: string): Promise<Result> {
  try {
    const { supabase, profile, who } = await requireStaff();
    const text = body.trim().slice(0, 2000);
    if (!text) return { error: "Write something first." };
    // Seeing the task through the user's own session is the permission check.
    const { data: task } = await supabase.from("tasks").select(TASK_COLS).eq("id", taskId).maybeSingle();
    if (!task) return { error: "You can't comment on this task." };
    const admin = getAdminClient();
    const { error } = await admin.from("task_comments").insert({ task_id: taskId, user_id: profile.id, body: text });
    if (error) return { error: error.message };
    const { data: people } = await admin.from("task_assignees").select("user_id").eq("task_id", taskId);
    const recipients = [...(people ?? []).map((p) => p.user_id as string), ...(task.created_by ? [task.created_by as string] : [])];
    await notify(task as { id: string; client_id: string; title: string; due_date: string | null }, recipients, profile.id, `${who}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`, "task_comment");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't add the comment." };
  }
}

// ---- Notifications (the bell) ----

export type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

export async function listNotifications(): Promise<{ unread: number; items: NotificationRow[] }> {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile) return { unread: 0, items: [] };
  const [{ data: items }, { count }] = await Promise.all([
    supabase.from("notifications").select("id, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  return { unread: count ?? 0, items: (items as NotificationRow[]) ?? [] };
}

export async function markNotificationRead(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id).is("read_at", null);
}

export async function markAllNotificationsRead(): Promise<void> {
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
}
