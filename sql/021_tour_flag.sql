-- First-login guided tour: shown once per user, then never again unless they
-- replay it from the profile menu. Existing users see it once on their next
-- login (default false), which is intended.
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS has_seen_tour BOOLEAN NOT NULL DEFAULT false;
