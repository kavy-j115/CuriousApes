-- Daily tasks (a simple board) and in-app notifications.
--
-- A task belongs to ONE client. Agency staff see the tasks of the clients they can
-- access (admins see all); client logins never see tasks. When a task is created for a
-- client, the users assigned to that client get a notification (done by the web app,
-- which writes the notification rows with the service role).

CREATE OR REPLACE FUNCTION is_agency_staff() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('admin', 'user'));
$$;

CREATE TABLE IF NOT EXISTS tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    title        TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    description  TEXT,
    status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority     TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    due_date     DATE,
    assignee_id  UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_by   UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tasks_client_status ON tasks (client_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks (assignee_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read tasks of their clients" ON tasks;
DROP POLICY IF EXISTS "staff add tasks for their clients" ON tasks;
DROP POLICY IF EXISTS "staff update tasks of their clients" ON tasks;
DROP POLICY IF EXISTS "staff delete own tasks admins any" ON tasks;
CREATE POLICY "staff read tasks of their clients" ON tasks FOR SELECT
    USING ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND has_client_access(client_id)));
CREATE POLICY "staff add tasks for their clients" ON tasks FOR INSERT
    WITH CHECK ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND has_client_access(client_id)));
CREATE POLICY "staff update tasks of their clients" ON tasks FOR UPDATE
    USING ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND has_client_access(client_id)))
    WITH CHECK ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND has_client_access(client_id)));
CREATE POLICY "staff delete own tasks admins any" ON tasks FOR DELETE
    USING ((SELECT is_admin()) OR created_by = auth.uid());

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'task',
    title       TEXT NOT NULL,
    body        TEXT,
    link        TEXT,
    task_id     UUID REFERENCES tasks(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, read_at, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users read their notifications" ON notifications;
DROP POLICY IF EXISTS "users mark their notifications read" ON notifications;
CREATE POLICY "users read their notifications" ON notifications FOR SELECT USING (user_id = (SELECT auth.uid()));
CREATE POLICY "users mark their notifications read" ON notifications FOR UPDATE
    USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
