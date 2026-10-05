import { getClients, getProfile } from "@/lib/dashboardData";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertRole } from "@/lib/auth/profile";
import TasksView, { type TaskItem, type StaffUser } from "./TasksView";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ task?: string; client?: string }> }) {
  const profile = await getProfile();
  if (!profile) return null;
  assertRole(profile, ["admin", "user"]);

  const { task: focusTask, client: clientParam } = await searchParams;
  const supabase = await createClient();
  const clients = await getClients();

  // Tasks are read with the user's own session: the rules in sql/038 limit them to the
  // user's clients (admins see all).
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, client_id, title, description, status, priority, due_date, assignee_id, created_by, created_at, completed_at")
    .order("created_at", { ascending: false })
    .limit(500);

  // People who can be named on a task: the users assigned to clients (not admins -- admins
  // hand tasks out, they are not given them) and which clients each one works on.
  const admin = getAdminClient();
  const clientIds = clients.map((c) => c.client_id);
  const [{ data: staff }, { data: access }] = await Promise.all([
    admin.from("user_profiles").select("id, display_name, email, role").eq("role", "user"),
    clientIds.length
      ? admin.from("client_access").select("user_id, client_id, expires_at").in("client_id", clientIds)
      : Promise.resolve({ data: [] as { user_id: string; client_id: string; expires_at: string | null }[] }),
  ]);
  const now = Date.now();
  const staffUsers: StaffUser[] = (staff ?? []).map((s) => ({
    id: s.id as string,
    name: (s.display_name as string | null) || (s.email as string | null) || "User",
    role: s.role as string,
    clientIds: (access ?? [])
      .filter((a) => a.user_id === s.id && (!a.expires_at || new Date(a.expires_at as string).getTime() > now))
      .map((a) => a.client_id as string),
  }));

  return (
    <TasksView
      tasks={(tasks ?? []) as TaskItem[]}
      clients={clients.map((c) => ({ id: c.client_id, name: c.display_name }))}
      staff={staffUsers}
      currentUserId={profile.id}
      isAdmin={profile.role === "admin"}
      focusTaskId={focusTask ?? null}
      initialClientId={clientParam ?? null}
    />
  );
}
