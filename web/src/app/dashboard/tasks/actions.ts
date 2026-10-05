"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/profile";

// Tasks are plain rows read and written with the logged-in user's own session, so the
// row-level rules in sql/038 decide who can see or change what (agency staff, only for
// the clients they can access). Only the notification rows are written with the service
// role, because they are addressed to OTHER users.

export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "medium" | "high";
export type TaskInput = {
  clientId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
};

async function requireStaff() {
  const supabase = await createClient();
  const profile = await getCurrentProfile(supabase);
  if (!profile || (profile.role !== "admin" && profile.role !== "user")) throw new Error("Tasks are for agency staff only.");
  return { supabase, profile };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  if (input.assigneeId !== undefined) out.assignee_id = input.assigneeId || null;
  return out;
}

// Who hears about a new task for a client: the users assigned to that client
// (permanent or unexpired temporary access) plus the named assignee, never the creator.
// A task can only be assigned to a user (not an admin or a client login).
async function assertAssignable(assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const { data } = await getAdminClient().from("user_profiles").select("role").eq("id", assigneeId).maybeSingle();
  if (data?.role !== "user") throw new Error("Tasks can only be assigned to users.");
}

async function recipientsFor(clientId: string, assigneeId: string | null, creatorId: string): Promise<string[]> {
  const admin = getAdminClient();
  const { data: access } = await admin
    .from("client_access")
    .select("user_id, expires_at")
    .eq("client_id", clientId);
  const now = Date.now();
  const ids = new Set<string>();
  for (const a of access ?? []) {
    if (!a.expires_at || new Date(a.expires_at as string).getTime() > now) ids.add(a.user_id as string);
  }
  if (assigneeId) ids.add(assigneeId);
  ids.delete(creatorId);
  if (ids.size === 0) return [];
  // Only users (never an admin -- admins hand tasks out -- and never a client login).
  const { data: staff } = await admin.from("user_profiles").select("id").in("id", [...ids]).eq("role", "user");
  return (staff ?? []).map((s) => s.id as string);
}

async function notifyTask(task: { id: string; client_id: string; title: string; due_date: string | null }, recipients: string[], byName: string, verb: string) {
  if (recipients.length === 0) return;
  const admin = getAdminClient();
  const { data: client } = await admin.from("clients").select("display_name").eq("client_id", task.client_id).maybeSingle();
  const clientName = (client?.display_name as string | undefined) ?? task.client_id;
  const body = `${clientName}${task.due_date ? ` · due ${task.due_date}` : ""} · ${verb} by ${byName}`;
  await admin.from("notifications").insert(
    recipients.map((userId) => ({
      user_id: userId,
      kind: "task",
      title: task.title,
      body,
      link: `/dashboard/tasks?task=${task.id}`,
      task_id: task.id,
    }))
  );
}

export async function createTask(input: TaskInput): Promise<{ ok: true } | { error: string }> {
  try {
    const { supabase, profile } = await requireStaff();
    if (!input.clientId) return { error: "Choose a client for the task." };
    const fields = clean({ ...input, title: input.title ?? "" });
    await assertAssignable(input.assigneeId);
    const { data, error } = await supabase
      .from("tasks")
      .insert({ client_id: input.clientId, created_by: profile.id, ...fields })
      .select("id, client_id, title, due_date")
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't create the task." };

    const recipients = await recipientsFor(input.clientId, input.assigneeId ?? null, profile.id);
    await notifyTask(
      { id: data.id as string, client_id: data.client_id as string, title: data.title as string, due_date: data.due_date as string | null },
      recipients,
      profile.display_name || profile.email || "a teammate",
      "added"
    );
    revalidatePath("/dashboard/tasks");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't create the task." };
  }
}

export async function updateTask(id: string, input: Partial<TaskInput>): Promise<{ ok: true } | { error: string }> {
  try {
    const { supabase, profile } = await requireStaff();
    const fields = clean(input);
    await assertAssignable(input.assigneeId);
    const { data: before } = await supabase.from("tasks").select("assignee_id").eq("id", id).maybeSingle();
    const { data, error } = await supabase
      .from("tasks")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, client_id, title, due_date, assignee_id")
      .single();
    if (error || !data) return { error: error?.message ?? "Couldn't save the task." };
    // A newly named assignee is told about it.
    if (input.assigneeId && input.assigneeId !== (before?.assignee_id as string | null) && input.assigneeId !== profile.id) {
      await notifyTask(
        { id: data.id as string, client_id: data.client_id as string, title: data.title as string, due_date: data.due_date as string | null },
        [input.assigneeId],
        profile.display_name || profile.email || "a teammate",
        "assigned to you"
      );
    }
    revalidatePath("/dashboard/tasks");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't save the task." };
  }
}

export async function setTaskStatus(id: string, status: TaskStatus): Promise<{ ok: true } | { error: string }> {
  try {
    const { supabase } = await requireStaff();
    if (!["todo", "in_progress", "done"].includes(status)) return { error: "Unknown status." };
    const { error } = await supabase
      .from("tasks")
      .update({ status, completed_at: status === "done" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { error: error.message };
    revalidatePath("/dashboard/tasks");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't move the task." };
  }
}

export async function deleteTask(id: string): Promise<{ ok: true } | { error: string }> {
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
