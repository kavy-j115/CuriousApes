import { getClients, getProfile, shiftDate, todayIn } from "@/lib/dashboardData";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth/profile";
import TasksView, { type TaskItem, type StaffUser } from "./TasksView";

const COLS = "id, client_id, title, description, status, priority, due_date, team, link, created_by, created_at, completed_at";
const AGENCY_TZ = "Asia/Kolkata";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string; client?: string }> }) {
  const profile = await getProfile();
  if (!profile) return null;
  assertRole(profile, ["admin", "user"]);

  const { task: focusTask, client: clientParam } = await searchParams;
  const supabase = await createClient();
  const today = todayIn(AGENCY_TZ);
  const admin = getAdminClient();

  // Everything open, plus only the last 30 days of finished work (and any task opened from a
  // notification) -- the board stays fast however much has been done over the years. Tasks
  // come from the user's own session, so sql/038 + sql/042 limit them to what they may see.
  const [clients, { data: open }, { data: done }, { data: focus }, { data: staff }] = await Promise.all([
    getClients(),
    supabase.from("tasks").select(COLS).neq("status", "done").order("due_date", { ascending: true, nullsFirst: false }).limit(1000),
    supabase.from("tasks").select(COLS).eq("status", "done").gte("completed_at", `${shiftDate(today, -30)}T00:00:00Z`).order("completed_at", { ascending: false }).limit(300),
    focusTask ? supabase.from("tasks").select(COLS).eq("id", focusTask).maybeSingle().then((r) => ({ data: r.data ? [r.data] : [] })) : Promise.resolve({ data: [] }),
    // People who can be named on a task (admins hand tasks out, they are not given them).
    admin.from("user_profiles").select("id, display_name, email, team").eq("role", "user"),
  ]);

  const byId = new Map<string, Record<string, unknown>>();
  for (const t of [...(open ?? []), ...(done ?? []), ...(focus ?? [])]) byId.set(t.id as string, t as Record<string, unknown>);
  const taskIds = [...byId.keys()];

  const clientIds = clients.map((c) => c.client_id);
  const taskClientIds = [...new Set([...byId.values()].map((t) => t.client_id as string))];
  const [{ data: assignRows }, { data: access }, { data: extraClients }] = await Promise.all([
    taskIds.length ? supabase.from("task_assignees").select("task_id, user_id").in("task_id", taskIds) : Promise.resolve({ data: [] as { task_id: string; user_id: string }[] }),
    clientIds.length
      ? admin.from("client_access").select("user_id, client_id, expires_at").in("client_id", clientIds)
      : Promise.resolve({ data: [] as { user_id: string; client_id: string; expires_at: string | null }[] }),
    // A designer may be named on a task for a brand they have no dashboard access to.
    taskClientIds.some((id) => !clientIds.includes(id))
      ? admin.from("clients").select("client_id, display_name").in("client_id", taskClientIds.filter((id) => !clientIds.includes(id)))
      : Promise.resolve({ data: [] as { client_id: string; display_name: string }[] }),
  ]);

  const assigneesByTask = new Map<string, string[]>();
  for (const r of assignRows ?? []) {
    const list = assigneesByTask.get(r.task_id as string) ?? [];
    list.push(r.user_id as string);
    assigneesByTask.set(r.task_id as string, list);
  }
  const tasks = [...byId.values()].map((t) => ({ ...t, assignee_ids: assigneesByTask.get(t.id as string) ?? [] })) as unknown as TaskItem[];

  const now = Date.now();
  const clientsByUser = new Map<string, string[]>();
  for (const a of access ?? []) {
    if (a.expires_at && new Date(a.expires_at as string).getTime() <= now) continue;
    const list = clientsByUser.get(a.user_id as string) ?? [];
    list.push(a.client_id as string);
    clientsByUser.set(a.user_id as string, list);
  }
  const staffUsers: StaffUser[] = (staff ?? [])
    .map((s) => ({
      id: s.id as string,
      name: (s.display_name as string | null) || (s.email as string | null) || "User",
      team: (s.team as string | null) ?? null,
      clientIds: clientsByUser.get(s.id as string) ?? [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <TasksView
      tasks={tasks}
      clients={clients.map((c) => ({ id: c.client_id, name: c.display_name }))}
      clientNames={Object.fromEntries([...clients.map((c) => [c.client_id, c.display_name]), ...(extraClients ?? []).map((c) => [c.client_id, c.display_name])])}
      staff={staffUsers}
      currentUserId={profile.id}
      isAdmin={profile.role === "admin"}
      focusTaskId={focusTask ?? null}
      initialClientId={clientParam ?? null}
      today={today}
    />
  );
}
