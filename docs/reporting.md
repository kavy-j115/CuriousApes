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
check should happen wherever this pipeline actually runs on a schedule —
revisit this when we get to Milestone 7 (automation), since a
Linux-based scheduler (e.g. GitHub Actions) would need LibreOffice
instead.

### Verified

Against real Shopify data (1 day, `dev_test`): Orders, Gross Sales, AOV,
MTD Sale all correct, Total row's AOV is a true weighted average
(`gross/orders`, not an average-of-daily-AOVs). Not yet verified against
real GA4/Meta data or a genuine multi-month date range — see
docs/metrics.md for what MTD/LMTD verification has been done
(synthetic data only).
