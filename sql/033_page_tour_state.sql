-- Guided tutorials are remembered per USER (not per browser): which pages' tutorials a
-- person has already seen, and whether they chose "Skip tour" on the main tour (which
-- turns the automatic page tutorials off for good; the sidebar Tutorial button still
-- works). People who had already finished the main tour before this existed are
-- treated the same way, so nobody gets tutorials for pages they already know.
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS seen_page_tours     TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS page_tours_disabled BOOLEAN NOT NULL DEFAULT false;

UPDATE user_profiles SET page_tours_disabled = true WHERE has_seen_tour = true;
