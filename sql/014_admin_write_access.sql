-- Building the admin UI (Clients/Users/Permissions pages) surfaced a real
-- gap: client_access had NO row level security enabled at all -- meaning
-- (before this migration) any authenticated user, including a 'client'
-- role, could read and write every row in it via the anon-key session
-- client, not just their own. Nothing in the UI exercised this path yet,
-- but it was a live hole. Fixed here alongside adding the write policies
-- admin actually needs (clients/user_profiles/client_access previously had
-- SELECT-only policies -- there was no RLS-sanctioned way for an admin to
-- create a client or provision a user without a service role key).

ALTER TABLE client_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage all client_access" ON client_access
    FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "users see their own client_access rows" ON client_access
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "admins manage clients" ON clients
    FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "admins update clients" ON clients
    FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "admins manage user_profiles" ON user_profiles
    FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "admins update user_profiles" ON user_profiles
    FOR UPDATE USING (is_admin()) WITH CHECK (is_admin());

-- Stored so the Users admin page can list accounts without needing a
-- service-role join against auth.users just to show an email address.
-- Populated at creation time (see web/src/app/dashboard/admin/actions.ts);
-- not kept in sync with auth.users automatically if it ever changes there.
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email TEXT;
