"""Runs the full pipeline (sync -> transform -> report) for every client in
config/clients/*.yaml. One client's failure, or one data source's failure,
never stops the others -- each step is isolated so a broken Meta token for
client A doesn't prevent client B's Shopify report from generating.

Run with: venv/Scripts/python -m src.scheduler.run_pipeline [--days N] [--meta-days N] [--client ID]
--days sets how far back the Shopify/Meta incremental sync looks (default
3, to catch late edits/refunds/attribution) -- not a full historical
backfill, which is a separate, deliberately unbuilt operation (see
docs/scheduling.md).
"""

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

from src.config.clients import load_all, get_value, resolve_secret
from src.connectors.meta_gate import META_GATE
from src.config.whatsapp_config import load_whatsapp_config
from src.config.report_config import load_report_config
from src.ingestion.shopify_orders import sync_orders as sync_shopify_orders
from src.ingestion.meta_insights import sync_insights as sync_meta_insights
from src.ingestion.ga4_sessions import sync_sessions as sync_ga4_sessions
from src.connectors.shopify_token import ShopifyTokenError, get_shopify_access_token
from src.ingestion.shopify_analytics import sync_landing_pages, sync_shopify_analytics
from src.connectors.shopify_analytics import ShopifyAnalyticsError
from src.transformations.shopify_orders import transform_orders
from src.reports.business_health_report import generate_report
from src.reports.storage import ensure_bucket_exists, upload_report
from src.analytics.alerts import Alert, check_metric_alerts, save_alerts, save_sync_failure_alert
from src.analytics.data_quality import run_data_quality_checks
from src.analytics.anomaly import check_anomalies
from src.notifications.dispatch import send_pending_alerts
from src.reports.whatsapp_reports import render_and_store_views, push_daily_report
from src.reports.summaries import generate_summaries

load_dotenv()

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "reports" / "output"


@dataclass
class StepResult:
    step: str
    status: str  # "ok" | "skipped" | "error"
    detail: str


def warn_expiring_meta_logins(conn) -> None:
    """A Facebook login (Connect Meta) lasts about 60 days. Within a week of expiry,
    every client that depends on it gets an alert, so a reconnect is never a surprise."""
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT c.fb_user_name, c.expires_at, cl.client_id
            FROM meta_connections c
            JOIN meta_ad_accounts a ON a.connection_id = c.id
            JOIN clients cl ON cl.meta_ad_account_id = a.account_id
            WHERE c.expires_at IS NOT NULL AND c.expires_at < now() + interval '7 days';
            """
        )
        rows = cur.fetchall()
        cur.close()
        for name, expires_at, client_id in rows:
            state = "expired" if expires_at < datetime.now(timezone.utc) else "expires"
            message = f"The Meta login for {name or 'a profile'} {state} on {expires_at:%d %b %Y} -- reconnect it on the Meta Accounts page."
            save_alerts(conn, client_id, date.today(), [Alert("meta_token_expiring", message)])
            print(f"  [WARN] {client_id}: {message}")
    except Exception as e:  # never let a warning stop the run
        print(f"  [WARN] couldn't check Meta login expiry: {e}")


def _last_complete_day(conn, client_id: str) -> date:
    """Yesterday in the client's own time zone -- the latest day that is whole."""
    cur = conn.cursor()
    cur.execute("SELECT (now() AT TIME ZONE timezone)::date FROM clients WHERE client_id = %s;", (client_id,))
    row = cur.fetchone()
    cur.close()
    return (row[0] if row else date.today()) - timedelta(days=1)


# How far back a store with the read_all_orders scope may be backfilled (about five years).
MAX_HISTORY_DAYS = 1825


def run_for_client(
    conn, config: dict, since: str, whatsapp_config: dict | None, meta_since: str | None = None, full_transform: bool = False,
    bulk: bool = False,
) -> list[StepResult]:
    client_id = config["client_id"]
    results: list[StepResult] = []

    store_domain = get_value(config, "shopify", "store_domain")
    # A custom app's token is plain and never expires; a public app's is an expiring pair that
    # is refreshed here when needed (see src/connectors/shopify_token.py).
    shopify_token = None
    if store_domain:
        try:
            shopify_token = get_shopify_access_token(conn, config, client_id, store_domain)
        except ShopifyTokenError as e:
            results.append(StepResult("Shopify token", "error", str(e)))
    if store_domain and shopify_token:
        try:
            # Taken before the sync so the transform below can pick up exactly
            # the orders this run saved (a few minutes of slack for clock drift).
            sync_started = datetime.now(timezone.utc) - timedelta(minutes=5)
            count = sync_shopify_orders(conn, client_id, store_domain, shopify_token, created_at_min=since, bulk=bulk)
            results.append(StepResult("Shopify sync", "ok", f"{count} orders"))
            try:
                t_count = transform_orders(conn, client_id, None if full_transform else sync_started)
                results.append(StepResult("Shopify transform", "ok", f"{t_count} orders"))
            except Exception as e:
                results.append(StepResult("Shopify transform", "error", str(e)))
        except Exception as e:
            results.append(StepResult("Shopify sync", "error", str(e)))
            results.append(StepResult("Shopify transform", "skipped", "sync failed"))

        # Shopify's own daily numbers (the same ones its Analytics page shows) --
        # these win over the order-derived figures for every day they cover.
        # Sessions come from Shopify only for clients without their own GA4.
        try:
            cur = conn.cursor()
            cur.execute("SELECT (now() AT TIME ZONE timezone)::date FROM clients WHERE client_id = %s;", (client_id,))
            row = cur.fetchone()
            cur.close()
            # Completed days only: the store's current day is still in progress, so
            # it is fetched (and shown) the next morning, once it is whole.
            store_today = ((row[0] if row else date.today()) - timedelta(days=1)).isoformat()
            sales_days, session_days = sync_shopify_analytics(
                conn, client_id, store_domain, shopify_token, since, store_today,
                include_sessions=not get_value(config, "ga4", "property_id"),
            )
            results.append(StepResult("Shopify analytics", "ok", f"{sales_days} sales days, {session_days} session days"))
        except Exception as e:
            results.append(StepResult("Shopify analytics", "error", str(e)))

        # Landing page report (Reports > Landing pages): the last two full months plus
        # this month so far. A query Shopify doesn't accept is reported as skipped, not
        # failed, so it never turns the daily run red on its own.
        try:
            last_day = _last_complete_day(conn, client_id)
            first = last_day.replace(day=1)
            for _ in range(2):
                first = (first - timedelta(days=1)).replace(day=1)
            pages = sync_landing_pages(conn, client_id, store_domain, shopify_token, first.isoformat(), last_day.isoformat())
            results.append(StepResult("Landing pages", "ok", f"{pages} page-month rows"))
        except ShopifyAnalyticsError as e:
            results.append(StepResult("Landing pages", "skipped", str(e)[:200]))
        except Exception as e:
            results.append(StepResult("Landing pages", "error", str(e)))
    elif not any(r.step == "Shopify token" for r in results):
        results.append(StepResult("Shopify sync", "skipped", "not configured for this client"))

    ad_account_id = get_value(config, "meta_ads", "ad_account_id")
    meta_token = resolve_secret(conn, config, "meta_ads", "access_token_secret")
    if ad_account_id and meta_token:
        try:
            until = _last_complete_day(conn, client_id).isoformat()
            # One ad account at a time, with a 10 ms gap when switching between clients
            # (clients run in parallel; Meta calls are deliberately not).
            with META_GATE.use(ad_account_id):
                count = sync_meta_insights(conn, client_id, ad_account_id, meta_token, meta_since or since, until)
            results.append(StepResult("Meta sync", "ok", f"{count} daily rows"))
        except Exception as e:
            results.append(StepResult("Meta sync", "error", str(e)))
    else:
        results.append(
            StepResult(
                "Meta sync",
                "skipped",
                "no Meta connection covers this client's ad account -- connect it on the Meta Accounts page"
                if ad_account_id
                else "not configured for this client",
            )
        )

    property_id = get_value(config, "ga4", "property_id")
    ga4_service_account_json = resolve_secret(conn, config, "ga4", "service_account_secret")
    if property_id and ga4_service_account_json:
        try:
            until = _last_complete_day(conn, client_id).isoformat()
            service_account_info = json.loads(ga4_service_account_json)
            count = sync_ga4_sessions(conn, client_id, property_id, service_account_info, since, until)
            results.append(StepResult("GA4 sync", "ok", f"{count} daily rows"))
        except Exception as e:
            results.append(StepResult("GA4 sync", "error", str(e)))
    else:
        results.append(StepResult("GA4 sync", "skipped", "not configured for this client"))

    # Read unconditionally, before any try block that could fail early --
    # the DHR step further down needs these regardless of whether the
    # on-demand Report step above it succeeds, so they can't live inside
    # that block's scope-by-accident (a NameError there would crash this
    # client's whole run instead of just recording a skip/error).
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    # Same report_config a client's web Reports page reads (sql/015_report_config.sql)
    # -- resolved once here and reused for both the on-demand Excel report
    # below and the DHR WhatsApp send further down, so both match the web.
    report_config = load_report_config(conn, client_id)

    rows: list[dict] = []
    trend_rows: list[dict] = []
    completed_rows: list[dict] = []
    try:
        # The daily report is month-to-date as of the last COMPLETE day: every day
        # from the 1st through yesterday, with a Total row. The current day is
        # left out until it is whole (it appears in tomorrow's report). On the
        # 1st this is the full previous month.
        last_complete = _last_complete_day(conn, client_id)
        month_start = last_complete.replace(day=1)
        store_today_date = last_complete + timedelta(days=1)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s AND report_date <= %s ORDER BY report_date;",
            (client_id, month_start, last_complete),
        )
        rows = cur.fetchall()
        # Alerts and anomaly detection compare today against recent days, which
        # must not shrink on the 1st of the month -- they get their own
        # trailing 30-day window, independent of the month-to-date report.
        cur.execute(
            "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s ORDER BY report_date;",
            (client_id, store_today_date - timedelta(days=30)),
        )
        trend_rows = cur.fetchall()
        # Alerts and anomaly detection judge COMPLETED days only: the store's
        # current day is still in progress (at 9 AM it holds a few hours of
        # orders), so comparing it with full days would raise a false alarm
        # every morning.
        completed_rows = [r for r in trend_rows if r["report_date"] < store_today_date]
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / f"{client_id}_business_health_report.xlsx"
        generate_report(rows, config.get("display_name", client_id), str(output_path), report_config)
        results.append(StepResult("Report", "ok", f"{len(rows)} rows -> {output_path.name}"))

        if supabase_url and service_role_key:
            try:
                ensure_bucket_exists(supabase_url, service_role_key)
                storage_path = upload_report(str(output_path), client_id, supabase_url, service_role_key)
                results.append(StepResult("Report upload", "ok", storage_path))
            except Exception as e:
                results.append(StepResult("Report upload", "error", str(e)))
        else:
            results.append(StepResult("Report upload", "skipped", "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set"))
    except Exception as e:
        results.append(StepResult("Report", "error", str(e)))

    # Weekly (last 7 days) / monthly (last 30 days) summary Excel files, refreshed
    # every run so the Reports page's download buttons are always current.
    try:
        summary_status = generate_summaries(
            conn, client_id, config.get("display_name", client_id), supabase_url, service_role_key,
            report_config,
        )
        results.append(StepResult("Summaries", "skipped" if summary_status[0].startswith("skipped") else "ok", "; ".join(summary_status)))
    except Exception as e:
        results.append(StepResult("Summaries", "error", str(e)))

    # Data quality checks: structural sanity on the clean layer, unconditional
    # (no per-client config) -- these catch broken ingestion, not business
    # swings, so they run every time regardless of whether thresholds exist.
    try:
        dq_alerts = run_data_quality_checks(conn, client_id, since)
        if dq_alerts:
            save_alerts(conn, client_id, date.today(), dq_alerts)
            results.append(StepResult("Data quality", "error", "; ".join(a.message for a in dq_alerts)))
        else:
            results.append(StepResult("Data quality", "ok", "no issues found"))
    except Exception as e:
        results.append(StepResult("Data quality", "error", str(e)))

    # Anomaly detection: z-score based, needs MIN_HISTORY_DAYS+1 rows of
    # history, so it's silent (not a false "nothing found") until that
    # history exists for this client.
    try:
        anomaly_alerts = check_anomalies(completed_rows)
        if anomaly_alerts:
            save_alerts(conn, client_id, completed_rows[-1]["report_date"], anomaly_alerts)
            results.append(StepResult("Anomaly detection", "ok", f"{len(anomaly_alerts)} anomaly(ies) found"))
        else:
            results.append(StepResult("Anomaly detection", "ok", "none found / insufficient history"))
    except Exception as e:
        results.append(StepResult("Anomaly detection", "error", str(e)))

    thresholds = get_value(config, "thresholds") or {}
    if not thresholds:
        results.append(StepResult("Alerts", "skipped", "no thresholds configured for this client"))
    elif len(completed_rows) < 2:
        results.append(StepResult("Alerts", "skipped", "insufficient history (need at least 2 days)"))
    else:
        today_row, yesterday_row = dict(completed_rows[-1]), dict(completed_rows[-2])
        # Merges in the accurate CAC denominator (new customers that day)
        # from daily_new_vs_returning (sql/019_new_vs_returning.sql) --
        # daily_report_metrics itself doesn't have this column, so
        # check_metric_alerts() would silently fall back to the old
        # spend/orders approximation without this.
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT order_date, new_customers FROM daily_new_vs_returning WHERE client_id = %s AND order_date IN (%s, %s);",
            (client_id, today_row["report_date"], yesterday_row["report_date"]),
        )
        new_customers_by_date = {r["order_date"]: r["new_customers"] for r in cur.fetchall()}
        cur.close()
        today_row["new_customers"] = new_customers_by_date.get(today_row["report_date"])
        yesterday_row["new_customers"] = new_customers_by_date.get(yesterday_row["report_date"])

        alerts = check_metric_alerts(today_row, yesterday_row, thresholds)
        if alerts:
            save_alerts(conn, client_id, today_row["report_date"], alerts)
            results.append(StepResult("Alerts", "ok", f"{len(alerts)} triggered: {', '.join(a.alert_type for a in alerts)}"))
        else:
            results.append(StepResult("Alerts", "ok", "none triggered"))

    # Every error already recorded above also becomes a persisted alert --
    # so a sync failure isn't only visible in this run's console output.
    for r in results:
        if r.status == "error":
            save_sync_failure_alert(conn, client_id, date.today(), r.step, r.detail)

    recipients = get_value(config, "notifications", "whatsapp_recipients") or []
    if not whatsapp_config:
        results.append(StepResult("WhatsApp notify", "skipped", "config/whatsapp.yaml not set up"))
    elif not recipients:
        results.append(StepResult("WhatsApp notify", "skipped", "no whatsapp_recipients for this client"))
    else:
        sent_count, send_errors = send_pending_alerts(conn, client_id, recipients, whatsapp_config)
        for alert_type, err in send_errors:
            results.append(StepResult(f"WhatsApp notify ({alert_type})", "error", err))
        if sent_count or not send_errors:
            results.append(StepResult("WhatsApp notify", "ok", f"{sent_count} alert(s) sent to {len(recipients)} recipient(s)"))

    # Report pictures: rendered every run (the WhatsApp bot replies from them),
    # and the month-to-date one is pushed to the client's registered numbers.
    if not supabase_url or not service_role_key:
        results.append(StepResult("Report images", "skipped", "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set"))
    else:
        display_name = config.get("display_name", client_id)
        try:
            views = render_and_store_views(conn, client_id, display_name, report_config, supabase_url, service_role_key)
            results.append(StepResult("Report images", "ok" if views else "skipped", ", ".join(views) or "no data yet"))
        except Exception as e:
            views = []
            results.append(StepResult("Report images", "error", str(e)))
        if "mtd" not in views:
            results.append(StepResult("WhatsApp daily report", "skipped", "no report image"))
        elif not whatsapp_config:
            results.append(StepResult("WhatsApp daily report", "skipped", "config/whatsapp.yaml not set up"))
        elif not recipients:
            results.append(StepResult("WhatsApp daily report", "skipped", "no whatsapp_recipients for this client"))
        else:
            # Captions: daily "Brand - 5 Oct 2026". On the 1st of a month the picture is the
            # whole finished month, sent once as "Brand - Monthly report" instead of a daily.
            is_monthly = views["mtd"].startswith("Monthly report")
            step = "WhatsApp monthly report" if is_monthly else "WhatsApp daily report"
            sent, send_errors = push_daily_report(
                client_id, display_name, recipients, whatsapp_config, supabase_url, service_role_key,
                "Monthly report" if is_monthly else views.get("yesterday", views["mtd"]), "mtd",
            )
            for err in send_errors:
                results.append(StepResult(step, "error", err))
            if sent:
                results.append(StepResult(step, "ok", f"sent to {sent} of {len(recipients)} recipient(s)"))
        # Weekly report: on Mondays the client also gets the last 7 completed days
        # (the previous Monday-Sunday) as a picture.
        if date.today().weekday() == 0 and "7d" in views and whatsapp_config and recipients:
            sent, send_errors = push_daily_report(
                client_id, display_name, recipients, whatsapp_config, supabase_url, service_role_key,
                views["7d"], "7d",  # caption: "Brand - 28 Sep to 4 Oct 2026"
            )
            for err in send_errors:
                results.append(StepResult("WhatsApp weekly report", "error", err))
            if sent:
                results.append(StepResult("WhatsApp weekly report", "ok", f"sent to {sent} of {len(recipients)} recipient(s)"))

    return results


def print_summary(client_id: str, results: list[StepResult]) -> None:
    print(f"\n{client_id}")
    print("-" * len(client_id))
    for r in results:
        symbol = {"ok": "OK", "skipped": "--", "error": "FAIL"}[r.status]
        print(f"  [{symbol}] {r.step}: {r.detail}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=3, help="how many days back to sync (default 3)")
    parser.add_argument(
        "--meta-days",
        type=int,
        default=None,
        help="how many days back to sync Meta Ads only (default: same as --days)",
    )
    parser.add_argument(
        "--full-transform",
        action="store_true",
        help="re-process every stored order, not just the ones this run fetched (first backfill, or after changing the transform)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="how many clients to process at the same time (default 4; use 1 for one after another)",
    )
    parser.add_argument(
        "--client",
        help="sync only this client_id, or several separated by commas (each still needs its sync switch on); default is every enabled client",
    )
    args = parser.parse_args()

    since = (date.today() - timedelta(days=args.days)).isoformat()
    meta_since = (date.today() - timedelta(days=args.meta_days)).isoformat() if args.meta_days is not None else None
    started_at = date.today().isoformat()

    print(f"D2C ANALYTICS PIPELINE\n{'-' * 22}\nStarted: {started_at} (syncing since {since})")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    clients = load_all(conn)

    if args.client:
        wanted = {x.strip() for x in args.client.split(",") if x.strip()}
        clients = [c for c in clients if c["client_id"] in wanted]
        if not clients:
            print(f"No client matching '{args.client}' -- nothing to do.")
            return

    if not clients:
        print("No clients found in config/clients/*.yaml -- nothing to do.")
        return

    whatsapp_config = load_whatsapp_config(conn)
    warn_expiring_meta_logins(conn)

    def process(config: dict, client_since: str, client_meta_since: str | None, owed, new_client: bool) -> list[StepResult]:
        """One client from start to finish, on its OWN database connection
        (a connection can't be shared between threads)."""
        worker_conn = psycopg2.connect(os.environ["DATABASE_URL"])
        try:
            results = run_for_client(worker_conn, config, client_since, whatsapp_config, client_meta_since, args.full_transform, bulk=new_client or bool(owed))
            if new_client and any(r.step == "Shopify sync" and r.status == "ok" for r in results):
                cur = worker_conn.cursor()
                cur.execute("UPDATE clients SET initial_sync_done = true WHERE client_id = %s;", (config["client_id"],))
                worker_conn.commit()
                cur.close()
            if owed and not any(r.status == "error" and r.step in ("Shopify sync", "Shopify analytics", "Meta sync") for r in results):
                cur = worker_conn.cursor()
                cur.execute("UPDATE clients SET backfill_from = NULL WHERE client_id = %s;", (config["client_id"],))
                worker_conn.commit()
                cur.close()
            return results
        finally:
            worker_conn.close()

    any_errors = False
    jobs = []
    for config in clients:
        # A client that only exists as a config file (no row in the database) cannot be
        # stored or alerted on -- skip it instead of failing every run.
        if "paused" not in config:
            print_summary(config["client_id"], [StepResult("Sync", "skipped", "only in a config file, not in the database")])
            continue
        if config.get("paused"):
            print_summary(config["client_id"], [StepResult("Sync", "skipped", "client is paused (disconnected)")])
            continue
        if config.get("sync_enabled") is False:
            print_summary(config["client_id"], [StepResult("Sync", "skipped", "switched off for this client")])
            continue
        # A reconnected client owes the days it was paused: start from the day it
        # was paused (never later than the normal window), for every source.
        owed = config.get("backfill_from")
        client_since = min(since, owed.isoformat()) if owed else since
        client_meta_since = min(meta_since or since, owed.isoformat()) if owed else meta_since
        # A reconnected client gets ONLY the days it was paused (from the day before it
        # was paused). A new or reconnected client is backfilled with Shopify's bulk export (one
        # file, not hundreds of pages), never further back than 60 days -- Shopify's
        # order window -- whenever it joined or however long it was paused.
        # A brand-new client gets only 3 days of Meta.
        # Shopify lets an app read only the last 60 days of orders, unless the store granted the
        # read_all_orders scope (clients.all_orders_access): then up to MAX_HISTORY_DAYS.
        max_history = MAX_HISTORY_DAYS if config.get("all_orders_access") else 60
        floor = (date.today() - timedelta(days=max_history)).isoformat()
        new_client = not config.get("initial_sync_done", True)
        if new_client:
            # How far back is chosen per client when it is added (0 = this month so far).
            cap_days = min(config.get("initial_backfill_days", 60), max_history)
            if owed:  # the start date picked in the "Sync now" pop-up
                client_since = max(owed.isoformat(), floor)
            elif cap_days == 0:
                client_since = (date.today() - timedelta(days=1)).replace(day=1).isoformat()
            else:
                client_since = (date.today() - timedelta(days=cap_days)).isoformat()
            client_meta_since = (date.today() - timedelta(days=3)).isoformat()
        elif owed:
            client_since = max(client_since, floor)
            client_meta_since = max(client_meta_since or client_since, floor)
        jobs.append((config, client_since, client_meta_since, owed, new_client))

    # Clients are independent, so several run at once; each prints as it finishes.
    workers = max(1, min(args.workers, len(jobs) or 1))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, *job): job[0]["client_id"] for job in jobs}
        for future in as_completed(futures):
            client_id = futures[future]
            try:
                results = future.result()
            except Exception as e:  # a crash in one client never stops the others
                results = [StepResult("Pipeline", "error", str(e))]
            print_summary(client_id, results)
            if any(r.status == "error" for r in results):
                any_errors = True

    conn.close()
    print(f"\nCompleted: {date.today().isoformat()}")
    if any_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
