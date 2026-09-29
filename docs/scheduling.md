# Scheduling

## Why GitHub Actions, not Windows Task Scheduler

Task Scheduler is simpler to set up but only runs while the machine is on,
logged in, and awake — a "daily report" that silently stops working
whenever a laptop is closed is a real reliability problem for something
people depend on. GitHub Actions runs in the cloud on a schedule regardless
of any local machine's state, and we already have the repo it needs.

## The orchestrator

`src/scheduler/run_pipeline.py` — one command that runs the full pipeline
for **every** client in `config/clients/*.yaml`:
Shopify sync → Shopify transform → Meta sync → Excel report.
(GA4 has no branch yet — no client has real credentials configured; see
docs/connectors.md.)

Run locally with:
```
venv/Scripts/python -m src.scheduler.run_pipeline [--days N]
```
`--days` (default 3) sets how far back the Shopify/Meta sync looks — this
is an **incremental** sync catching recent edits/refunds/attribution
changes, not a full historical backfill (backfilling a brand-new client's
entire order history is a separate, deliberately unbuilt operation, since
it needs different pagination/rate-limit handling for a much larger pull).

**Isolation is the key design point:** one client's failure, or one data
source's failure within a client, never stops anything else. A broken Meta
token for client A doesn't prevent client A's Shopify report from
generating, and doesn't touch client B at all. Each step's outcome
(`ok`/`skipped`/`error`) is tracked independently and printed in a per-client
summary — the "structured logging" style from the original project brief.

## GitHub Actions

`.github/workflows/pipeline.yml` runs the orchestrator daily at 03:30 UTC
(09:00 IST) via a scheduled workflow, plus supports a manual trigger
(`workflow_dispatch`) from the Actions tab for testing without waiting for
the schedule.

**Setup required (one-time):** just one secret — go to the repo's
**Settings → Secrets and variables → Actions** and add `DATABASE_URL`.
Every per-client credential lives in Supabase Vault instead, reached
through that same connection — see docs/secrets.md for why this changed
from the four secrets this originally required, and why `DATABASE_URL`
specifically can't move into Vault too.

**Closes a gap noted in docs/reporting.md:** GitHub Actions runners are
Linux, so LibreOffice's formula recalculation (which didn't work on this
Windows dev machine due to a `socket.AF_UNIX` limitation) works natively
there via a simple `soffice --headless --convert-to xlsx` round-trip —
no COM automation workaround needed in the actual scheduled environment.

**Output:** generated `.xlsx` reports are uploaded as a workflow run
artifact (downloadable from the Actions tab, kept 30 days) — a
lightweight stand-in for the "download from the dashboard" feature that
was deliberately deferred.

## Not yet built

A full historical backfill command/flag, alerting on repeated failures,
and the deferred Supabase-Storage-backed download-from-UI feature.
