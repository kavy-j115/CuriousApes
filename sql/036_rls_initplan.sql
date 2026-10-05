-- Speed: row-level-security policies call is_admin() once PER ROW, which made every
-- dashboard query for a logged-in user 5-10x slower than the same query run directly
-- (e.g. daily_report_metrics 951 ms vs 173 ms). Wrapping the call in a sub-select lets
-- Postgres evaluate it ONCE per query ("initplan"). Same rule, same result, only
-- cheaper: every policy that uses is_admin() is rewritten in place.
DO $$
DECLARE
    p record;
    new_using text;
    new_check text;
    stmt text;
BEGIN
    FOR p IN
        SELECT schemaname, tablename, policyname, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND ((qual LIKE '%is_admin()%' AND qual NOT LIKE '%SELECT is_admin()%')
            OR (with_check LIKE '%is_admin()%' AND with_check NOT LIKE '%SELECT is_admin()%'))
    LOOP
        stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
        IF p.qual IS NOT NULL THEN
            new_using := replace(p.qual, 'is_admin()', '(SELECT is_admin())');
            stmt := stmt || format(' USING (%s)', new_using);
        END IF;
        IF p.with_check IS NOT NULL THEN
            new_check := replace(p.with_check, 'is_admin()', '(SELECT is_admin())');
            stmt := stmt || format(' WITH CHECK (%s)', new_check);
        END IF;
        EXECUTE stmt;
    END LOOP;
END
$$;
