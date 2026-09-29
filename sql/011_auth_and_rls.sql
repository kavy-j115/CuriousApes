-- Auth + Row Level Security, implementing the three-role model captured
-- earlier: admin (agency owner/lead, sees everything), user (growth
-- marketer, scoped to assigned clients, can be assigned to several --
-- the "collab" feature), client (brand owner, scoped to exactly one
-- client). See docs/auth.md for the full design and verification.
--
-- IMPORTANT correctness detail #1: RLS policies live on TABLES, not views.
-- Every view in this project's chain (daily_business_metrics ->
-- daily_report_metrics, daily_meta_metrics, daily_ga4_metrics) must be
-- marked security_invoker so a query against the view runs the RLS
-- policies of the CALLING user against the underlying tables, not the
-- view owner's (superuser-like) privileges. Without this, RLS would
-- silently do nothing when queried through these views.
--
-- IMPORTANT correctness detail #2: a policy on user_profiles that queries
-- user_profiles itself (to check "is this user an admin?") causes
-- INFINITE RECURSION -- querying the table re-triggers its own RLS
-- policy, which queries the table again, forever. Caught by direct
-- testing (scripts/verify_rls.py), not assumed away. Fixed with the
-- standard pattern: a SECURITY DEFINER function, which runs as its
-- owner (bypassing RLS) rather than as the querying user, breaking the
-- cycle. Both helper functions below exist specifically to avoid any
-- policy embedding a raw subquery against an RLS-protected table.

CREATE TABLE IF NOT EXISTS user_profiles (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role          TEXT NOT NULL CHECK (role IN ('admin', 'user', 'client')),
    display_name  TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Many-to-many: which client(s) a 'user' or 'client' role can see.
-- A 'user' can have several rows here (the collab feature -- a growth
-- marketer assigned to multiple brands). A 'client' role should have
-- exactly one row by convention (enforced by onboarding process, not a
-- DB constraint -- RLS treats 'user' and 'client' identically: both are
-- scoped to whatever rows exist here for them).
CREATE TABLE IF NOT EXISTS client_access (
    user_id    UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    client_id  TEXT NOT NULL REFERENCES clients(client_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, client_id)
);

-- SECURITY DEFINER: runs as the function owner, not the calling user --
-- this is what lets it read user_profiles/client_access without
-- triggering their RLS policies (and therefore without recursing).
CREATE OR REPLACE FUNCTION is_admin() RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin');
$$;

CREATE OR REPLACE FUNCTION has_client_access(check_client_id TEXT) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM client_access
        WHERE user_id = auth.uid() AND client_id = check_client_id
    );
$$;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see their own profile" ON user_profiles
    FOR SELECT USING (id = auth.uid());
CREATE POLICY "admins see all profiles" ON user_profiles
    FOR SELECT USING (is_admin());

-- Reusable pattern for every client-scoped table below: two permissive
-- policies for the same action are OR'd together by Postgres, so a row
-- is visible if EITHER "is admin" OR "has explicit client_access" matches.

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all clients" ON clients FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned clients" ON clients FOR SELECT USING (has_client_access(client_id));

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all orders" ON orders FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned orders" ON orders FOR SELECT USING (has_client_access(client_id));

ALTER TABLE order_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all line items" ON order_line_items FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned line items" ON order_line_items FOR SELECT USING (
    EXISTS (SELECT 1 FROM orders WHERE orders.id = order_line_items.order_id AND has_client_access(orders.client_id))
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all customers" ON customers FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned customers" ON customers FOR SELECT USING (has_client_access(client_id));

ALTER TABLE raw_shopify_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all raw shopify orders" ON raw_shopify_orders FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned raw shopify orders" ON raw_shopify_orders FOR SELECT USING (has_client_access(client_id));

ALTER TABLE raw_meta_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all meta insights" ON raw_meta_insights FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned meta insights" ON raw_meta_insights FOR SELECT USING (has_client_access(client_id));

ALTER TABLE raw_ga4_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all ga4 sessions" ON raw_ga4_sessions FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned ga4 sessions" ON raw_ga4_sessions FOR SELECT USING (has_client_access(client_id));

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all alerts" ON alerts FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned alerts" ON alerts FOR SELECT USING (has_client_access(client_id));

ALTER TABLE ai_daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins see all ai reports" ON ai_daily_reports FOR SELECT USING (is_admin());
CREATE POLICY "scoped users see their assigned ai reports" ON ai_daily_reports FOR SELECT USING (has_client_access(client_id));

-- Views: security_invoker so RLS on the underlying tables above actually
-- applies to the querying user, instead of running as the view owner.
ALTER VIEW daily_business_metrics SET (security_invoker = true);
ALTER VIEW daily_meta_metrics SET (security_invoker = true);
ALTER VIEW daily_ga4_metrics SET (security_invoker = true);
ALTER VIEW daily_report_metrics SET (security_invoker = true);
