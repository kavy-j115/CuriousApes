-- Task manager v2: teams (SMM, graphics, video...), several assignees per task, a review
-- stage, comments, a deliverable link, due-date reminders, and indexes for the new queries.
--
-- Writes to task_assignees / task_comments are done by the web app with the service role
-- AFTER it has checked (with the user's own session) that the user can see the task, so these
-- two tables only need read policies.

-- A person's function in the agency. Free text on purpose: the allowed values live in the
-- web app (web/src/lib/teams.ts), so a new kind of editor needs no migration.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS team TEXT;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS link TEXT;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('todo', 'in_progress', 'review', 'done'));

CREATE TABLE IF NOT EXISTS task_assignees (
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees (user_id);

-- Older tasks had a single assignee_id; carry it over. The column stays (unused) so nothing
-- that still selects it breaks.
INSERT INTO task_assignees (task_id, user_id)
SELECT id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS task_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
    body       TEXT NOT NULL CHECK (length(btrim(body)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments (task_id, created_at);

-- SECURITY DEFINER so a policy on tasks can look at task_assignees without recursing.
CREATE OR REPLACE FUNCTION is_task_assignee(check_task_id UUID) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM task_assignees WHERE task_id = check_task_id AND user_id = auth.uid());
$$;

-- Someone named on a task can see it and move it along even without access to the client
-- (a designer serving many brands is not given every brand's dashboard).
DROP POLICY IF EXISTS "staff read tasks of their clients" ON tasks;
DROP POLICY IF EXISTS "staff update tasks of their clients" ON tasks;
CREATE POLICY "staff read tasks of their clients" ON tasks FOR SELECT
    USING ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND (has_client_access(client_id) OR is_task_assignee(id))));
CREATE POLICY "staff update tasks of their clients" ON tasks FOR UPDATE
    USING ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND (has_client_access(client_id) OR is_task_assignee(id))))
    WITH CHECK ((SELECT is_admin()) OR ((SELECT is_agency_staff()) AND (has_client_access(client_id) OR is_task_assignee(id))));

ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "read assignees of visible tasks" ON task_assignees;
DROP POLICY IF EXISTS "read comments of visible tasks" ON task_comments;
CREATE POLICY "read assignees of visible tasks" ON task_assignees FOR SELECT
    USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));
CREATE POLICY "read comments of visible tasks" ON task_comments FOR SELECT
    USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id));

-- Page queries: open tasks by due date, recent finished ones, and the team filter.
CREATE INDEX IF NOT EXISTS idx_tasks_open_due ON tasks (due_date) WHERE status <> 'done';
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks (completed_at DESC) WHERE status = 'done';
CREATE INDEX IF NOT EXISTS idx_tasks_team ON tasks (team);

-- One reminder per person per task per day for tasks due today or already overdue. Called
-- by the daily pipeline run (scripts do not need the web app for this).
CREATE OR REPLACE FUNCTION task_due_reminders(today DATE) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO notifications (user_id, kind, title, body, link, task_id)
    SELECT a.user_id,
           'task_due',
           t.title,
           CASE WHEN t.due_date < today THEN 'Overdue since ' || t.due_date ELSE 'Due today' END,
           '/dashboard/tasks?task=' || t.id,
           t.id
    FROM tasks t
    JOIN task_assignees a ON a.task_id = t.id
    WHERE t.status <> 'done'
      AND t.due_date IS NOT NULL
      AND t.due_date <= today
      AND NOT EXISTS (
          SELECT 1 FROM notifications n2
          WHERE n2.task_id = t.id AND n2.user_id = a.user_id AND n2.kind = 'task_due'
            AND n2.created_at >= today::timestamptz
      );
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION task_due_reminders(DATE) FROM PUBLIC, anon, authenticated;
