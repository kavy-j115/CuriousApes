-- Collab feature: temporary client access, e.g. an admin covering for a
-- team member who's out. NULL = a normal permanent grant (unchanged
-- behavior). A non-null expires_at makes the grant time-limited --
-- has_client_access() checks it below, so an expired grant simply stops
-- working the moment it passes, with no cron job or cleanup step needed
-- to "turn it off". The row itself is left in place after expiry (not
-- deleted) so there's a record of who had temporary access to what, and
-- when -- useful for Permissions/Data Sources style auditing later.
ALTER TABLE client_access ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION has_client_access(check_client_id TEXT) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM client_access
        WHERE user_id = auth.uid()
          AND client_id = check_client_id
          AND (expires_at IS NULL OR expires_at > now())
    );
$$;

-- Admin delete policies (System Settings' delete-user/delete-client
-- actions). client_access already had a FOR ALL admin policy (migration
-- 014), which already covers delete -- these two tables only had
-- INSERT/UPDATE for admin before, no DELETE.
CREATE POLICY "admins delete clients" ON clients
    FOR DELETE USING (is_admin());
CREATE POLICY "admins delete user_profiles" ON user_profiles
    FOR DELETE USING (is_admin());
