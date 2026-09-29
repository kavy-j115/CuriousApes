# AI Analyst

## Architecture (enforced deliberately, per the original brief)

```
Platform APIs -> PostgreSQL -> SQL/Python -> validated metrics -> AI -> interpretation
```

**Not** `raw data -> AI -> numbers`. Every number the AI sees in
`src/ai/daily_analyst.py` was already computed and validated elsewhere in
this pipeline (`daily_report_metrics`, the same view the Excel report and
UI read from). The AI is never handed raw orders/sessions and asked to
compute anything — `_metric_context()` builds the entire numeric summary in
Python before the AI ever sees it. This also means the AI's job is
strictly narrower than it might seem: describe and interpret numbers that
are already known to be correct, not decide what's true.

## FACT / INTERPRETATION / HYPOTHESIS

The system prompt requires the AI to label every claim as one of these
three, and explicitly forbids presenting a hypothesis as settled fact —
directly from the original brief's requirement. A metric that's
`unavailable` (GA4/Meta not connected for a client, or no data yet) is
reported as a data-quality note, not guessed at or silently dropped.

## Credential: platform-wide, not per-client

`ANTHROPIC_API_KEY` is the agency's own Anthropic account, used across
every client's reports — unlike Shopify/Meta tokens (per-client, stored in
Supabase Vault, see docs/secrets.md), this one belongs in `.env` /
GitHub Actions Secrets alongside `DATABASE_URL`, since it isn't tied to
any single brand.

## A real dependency conflict, fixed rather than worked around

`anthropic==0.39.0` (the version originally pinned when this project's
`requirements.txt` was first written, before any AI code existed) turned
out incompatible with the `httpx` version pip resolves today — its
internal client construction passes a `proxies` kwarg that a newer httpx
removed, raising `TypeError` on `anthropic.Anthropic(...)` construction on
the very first attempt to use it. Fixed by upgrading to current stable
(`1.9.0`) rather than pinning `httpx` backwards, and verified the new
version's actual `messages.create()` signature via introspection before
writing code against it, rather than assuming the API surface matches
older documentation.

## `get_metrics_for_analysis()`

Returns the **most recent date with data** for a client (not necessarily
today's calendar date — a client's sync may lag) as "today", plus a
trailing window of days before it as historical context for the AI to
compare against. Verified against real `dev_test` data: correctly
returned the one real day of data, correctly reported zero trailing days
(honest — there is no history yet), and correctly showed `unavailable`
rather than a fake value for every Meta/GA4-sourced metric, matching the
same blank-vs-zero principle used everywhere else in this project.

## Storage

`ai_daily_reports` (`sql/009_ai_reports.sql`) — one row per (client, date),
upserted so regenerating a day's report is safe. Not yet surfaced in the
UI.

## Running it

```
venv/Scripts/python scripts/generate_daily_analysis.py --client dev_test
```

## Verified

The deterministic context-building (`_metric_context`) was verified
against real data before any API call was made. The actual API call
(`generate_daily_analysis`) is pending an `ANTHROPIC_API_KEY` being added.

## Not built yet

Weekly/monthly reports (the brief specifies these as later, larger-scope
versions of the same daily concept), UI display of saved reports, and
wiring this into the scheduled pipeline (`src/scheduler/run_pipeline.py`).
