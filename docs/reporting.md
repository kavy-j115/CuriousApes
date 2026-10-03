# Reporting

## Business Health Report

`src/reports/business_health_report.py` generates the `.xlsx` matching the
target format supplied by the user — title row, blue header, one row per
day, a Total row, and a red→yellow→green color scale on PROAS.
`scripts/generate_business_health_report.py` is the runner (pulls the last
28 days from `daily_report_metrics` for one client).

### Formulas, not hardcoded numbers

Every Total-row cell is a real Excel formula (`=SUM(...)`, or a ratio like
`=IFERROR(purchase_value_total/spend_total,0)`), not a Python-computed
number written in as a literal. This means the sheet stays correct if
someone edits a data cell by hand later — the totals recompute themselves,
the way a spreadsheet should.

One column (`Checkouts (raw)`) exists only as a **hidden** column, purely so
the Checkout % total can be a real formula (`SUM(checkouts)/SUM(sessions)`)
instead of a number typed in with no cell backing it — it's not part of the
target format's visible columns.

### Blank vs. zero

Sessions/Ad Spend/PROAS/ATC%/Conversion%/Checkout% are left genuinely
**blank** on any date where GA4/Meta have no data — never a fake `0`. A `0`
would silently claim "we know spend was zero," which isn't true; blank
honestly says "we don't know yet." A cell comment on the Sessions header
explains this directly on the sheet itself, not just in this doc.

### Documented assumptions on the sheet itself

The Conversion % header carries a cell comment stating its formula
(Shopify orders ÷ GA4 sessions) plainly, since that definition crosses two
data sources and was an assumption we made rather than something the user
explicitly specified — see docs/metrics.md.

### Recalculation

openpyxl writes formulas as text with no cached value — anything reading
the file without recalculating (e.g. `pandas`, or `data_only=True`) sees
`None` until something recalculates it. Real Excel/Google Sheets do this
automatically on open, so this mostly matters for automated
verification. This dev environment has no LibreOffice and its
`socket.AF_UNIX`-based automation doesn't work on this Windows/Python
combination — we used Excel itself via COM automation
(`pywin32`) as a Windows-native substitute to force recalculation and
scan for formula errors before shipping the file. That script isn't part
of the project (it's a one-off dev verification tool), but the same
check should happen wherever this pipeline actually runs on a schedule.
**Resolved at Milestone 7:** the GitHub Actions workflow
(docs/scheduling.md) runs on Linux, where LibreOffice's `socket.AF_UNIX`
automation works natively — a plain `soffice --headless --convert-to
xlsx` round-trip recalculates every generated report as part of the
scheduled run. The Windows/COM workaround above remains useful for local
manual verification only.

### Verified

Against real Shopify data (1 day, `dev_test`): Orders, Gross Sales, AOV,
MTD Sale all correct, Total row's AOV is a true weighted average
(`gross/orders`, not an average-of-daily-AOVs). Not yet verified against
real GA4/Meta data or a genuine multi-month date range — see
docs/metrics.md for what MTD/LMTD verification has been done
(synthetic data only).

## Storage upload + UI download

`src/reports/storage.py` uploads each generated report to Supabase Storage
(`reports/<client_id>/<filename>`, overwriting the previous run's file
rather than accumulating versions) via plain REST calls to Supabase's
Storage API, using the **service role key** — deliberately, not the anon
key, since uploading is a write and, with RLS now enabled (docs/auth.md),
a public bucket for these files would undo that work (a report contains
one client's full data).

The Next.js **download button** (`web/src/app/api/reports/[clientId]/route.ts`)
was completed the same night, once the login integration (docs/auth.md)
resolved the blocker that had deferred it. Two-step authorization, not
one: the user's own session decides *whether* they can have a given
client's file (piggybacking directly on RLS — querying `clients` for the
requested ID via the normal session-aware client returns nothing at all
if the user lacks access, real or fake client_id alike, so there's no
separate authorization check to get wrong), then the service role key
fetches the file server-side only after that's already proven. The key
never reaches the browser and is never used to *decide* access, only to
fetch once access is already established.

**Verified:** the route (and every route, confirmed) is protected by the
proxy before even reaching its own logic — navigating to it while logged
out redirects to `/login`, the same as any page. **Not yet verified:** an
authorized download actually succeeding, since that needs both a real
logged-in session and `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (neither
set yet) — the code fails clearly (a 503 with an explicit message) rather
than crashing if the storage credentials are missing.

## DHR (Daily/Weekly/Monthly over WhatsApp)

The WhatsApp report (see docs/notifications.md; formerly `src/reports/dhr.py`) sends the Business Health Report as a PNG
instead of (or alongside) the on-demand download — see docs/notifications.md
for the WhatsApp/Twilio side. Reuses `generate_report()` unchanged: a
"weekly" or "monthly" DHR is just that same function given a wider range
of `daily_report_metrics` rows (last 7 days, or month-to-date), which
*already* produces one row per day plus a weighted Total row — confirmed
by reading the function rather than assumed, so no separate aggregation
logic was needed for the rollup periods.

### report_config now reaches Python too

`src/reports/report_columns.py` mirrors `web/src/lib/reportColumns.ts`'s
metric catalogue and default set by hand (two languages, no shared schema
file) — `resolve_columns()`/`resolve_roas_thresholds()` turn a client's
`report_config` (read via `src/config/report_config.py`) into the same
`(label, db_column, number_format)` tuples `generate_report()` always
took, so both the on-demand Excel download and the DHR now match what
that client's web Reports page shows, not a separately-fixed format.

`generate_report()`'s Total-row ratio formulas (AOV, PROAS, ATC%, etc.)
each depend on two other columns (e.g. AOV needs both `gross_revenue` and
`order_count` present) — a client's config can legally omit one of those
while keeping the ratio column. Verified directly: dropping `order_count`
from a test config left AOV's Total cell blank rather than crashing or
computing a wrong number, and a config with no `proas` column correctly
skips the conditional-formatting block entirely instead of erroring on a
missing column lookup. PROAS's color scale is now anchored to the
client's actual `roasThresholds` (`good`/`danger`) instead of an
auto data-driven min/max, so the Excel/DHR coloring agrees with the same
client's web Reports page instead of two independently-scaled gradients
for the same number.

Delivery needs a signed Storage URL (`storage.create_signed_url()`), not
a direct upload, because the `reports` bucket is deliberately private
(see "Storage upload" above) but Twilio's servers need to fetch the file
over plain HTTP to attach it to a WhatsApp message — a 1-hour-expiry
signed URL is the one deliberate, short-lived exception to "never public."

**Not yet verified live** — needs both `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
and a configured Twilio sender (docs/notifications.md), neither set up yet.
