-- New accounts (and accounts an admin resets) get a temporary password and must
-- choose their own at first login. Existing accounts are unaffected (false).
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
