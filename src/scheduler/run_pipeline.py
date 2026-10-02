"""Runs the full pipeline (sync -> transform -> report) for every client in
config/clients/*.yaml. One client's failure, or one data source's failure,
never stops the others -- each step is isolated so a broken Meta token for
client A doesn't prevent client B's Shopify report from generating.

Run with: venv/Scripts/python -m src.scheduler.run_pipeline [--days N]
--days sets how far back the Shopify/Meta incremental sync looks (default
3, to catch late edits/refunds/attribution) -- not a full historical
backfill, which is a separate, deliberately unbuilt operation (see
docs/scheduling.md).
"""

import argparse
import json
import os
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from dotenv import load_dotenv
import psycopg2
import psycopg2.extras

from src.config.clients import load_all, get_value, resolve_secret
from src.config.whatsapp_config import load_whatsapp_config
from src.config.report_config import load_report_config
from src.reports.report_columns import resolve_columns, resolve_roas_thresholds
from src.ingestion.shopify_orders import sync_orders as sync_shopify_orders
from src.ingestion.meta_insights import sync_insights as sync_meta_insights
from src.ingestion.ga4_sessions import sync_sessions as sync_ga4_sessions
from src.transformations.shopify_orders import transform_orders
from src.reports.business_health_report import generate_report
from src.reports.storage import ensure_bucket_exists, upload_report
from src.analytics.alerts import check_metric_alerts, save_alerts, save_sync_failure_alert
from src.analytics.data_quality import run_data_quality_checks
from src.analytics.anomaly import check_anomalies
from src.notifications.dispatch import send_pending_alerts
from src.reports.dhr import generate_and_send_dhr
from src.reports.summaries import generate_summaries

load_dotenv()

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "reports" / "output"


@dataclass
class StepResult:
    step: str
    status: str  # "ok" | "skipped" | "error"
    detail: str


def run_for_client(conn, config: dict, since: str, whatsapp_config: dict | None) -> list[StepResult]:
    client_id = config["client_id"]
    results: list[StepResult] = []

    store_domain = get_value(config, "shopify", "store_domain")
    shopify_token = resolve_secret(conn, config, "shopify", "access_token_secret")
    if store_domain and shopify_token:
        try:
            count = sync_shopify_orders(conn, client_id, store_domain, shopify_token, created_at_min=since)
            results.append(StepResult("Shopify sync", "ok", f"{count} orders"))
            try:
                t_count = transform_orders(conn, client_id)
                results.append(StepResult("Shopify transform", "ok", f"{t_count} orders"))
            except Exception as e:
                results.append(StepResult("Shopify transform", "error", str(e)))
        except Exception as e:
            results.append(StepResult("Shopify sync", "error", str(e)))
            results.append(StepResult("Shopify transform", "skipped", "sync failed"))
    else:
        results.append(StepResult("Shopify sync", "skipped", "not configured for this client"))

    ad_account_id = get_value(config, "meta_ads", "ad_account_id")
    meta_token = resolve_secret(conn, config, "meta_ads", "access_token_secret")
    if ad_account_id and meta_token:
        try:
            until = date.today().isoformat()
            count = sync_meta_insights(conn, client_id, ad_account_id, meta_token, since, until)
            results.append(StepResult("Meta sync", "ok", f"{count} daily rows"))
        except Exception as e:
            results.append(StepResult("Meta sync", "error", str(e)))
    else:
        results.append(StepResult("Meta sync", "skipped", "not configured for this client"))

    property_id = get_value(config, "ga4", "property_id")
    ga4_service_account_json = resolve_secret(conn, config, "ga4", "service_account_secret")
    if property_id and ga4_service_account_json:
        try:
            until = date.today().isoformat()
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
    report_columns = resolve_columns(report_config)
    roas_thresholds = resolve_roas_thresholds(report_config)

    rows: list[dict] = []
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM daily_report_metrics WHERE client_id = %s AND report_date >= %s ORDER BY report_date;",
            (client_id, since),
        )
        rows = cur.fetchall()
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / f"{client_id}_business_health_report.xlsx"
        generate_report(rows, config.get("display_name", client_id), str(output_path), report_columns, roas_thresholds)
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
            report_columns, roas_thresholds,
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
        anomaly_alerts = check_anomalies(rows)
        if anomaly_alerts:
            save_alerts(conn, client_id, date.today(), anomaly_alerts)
            results.append(StepResult("Anomaly detection", "ok", f"{len(anomaly_alerts)} anomaly(ies) found"))
        else:
            results.append(StepResult("Anomaly detection", "ok", "none found / insufficient history"))
    except Exception as e:
        results.append(StepResult("Anomaly detection", "error", str(e)))

    thresholds = get_value(config, "thresholds") or {}
    if not thresholds:
        results.append(StepResult("Alerts", "skipped", "no thresholds configured for this client"))
    elif len(rows) < 2:
        results.append(StepResult("Alerts", "skipped", "insufficient history (need at least 2 days)"))
    else:
        today_row, yesterday_row = dict(rows[-1]), dict(rows[-2])
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

    # DHR: always attempts "daily"; "weekly" additionally fires on Mondays,
    # "monthly" additionally fires on the 1st -- one daily cron trigger
    # covers all three cadences instead of needing separate schedules.
    if whatsapp_config:
        dhr_periods = ["daily"]
        if date.today().weekday() == 0:
            dhr_periods.append("weekly")
        if date.today().day == 1:
            dhr_periods.append("monthly")
        for period in dhr_periods:
            try:
                status = generate_and_send_dhr(
                    conn, client_id, config.get("display_name", client_id), period,
                    recipients, whatsapp_config, supabase_url, service_role_key,
                    report_columns, roas_thresholds,
                )
                results.append(StepResult(f"DHR ({period})", "ok" if status.startswith("sent") else "skipped", status))
            except Exception as e:
                results.append(StepResult(f"DHR ({period})", "error", str(e)))
    else:
        results.append(StepResult("DHR", "skipped", "config/whatsapp.yaml not set up"))

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
        "--client",
        help="sync only this client_id (still requires its sync switch to be on); default is every enabled client",
    )
    args = parser.parse_args()

    since = (date.today() - timedelta(days=args.days)).isoformat()
    started_at = date.today().isoformat()

    print(f"D2C ANALYTICS PIPELINE\n{'-' * 22}\nStarted: {started_at} (syncing since {since})")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    clients = load_all(conn)

    if args.client:
        clients = [c for c in clients if c["client_id"] == args.client]
        if not clients:
            print(f"No client with client_id '{args.client}' -- nothing to do.")
            return

    if not clients:
        print("No clients found in config/clients/*.yaml -- nothing to do.")
        return

    whatsapp_config = load_whatsapp_config(conn)

    any_errors = False
    for config in clients:
        if config.get("sync_enabled") is False:
            print_summary(config["client_id"], [StepResult("Sync", "skipped", "switched off for this client")])
            continue
        results = run_for_client(conn, config, since, whatsapp_config)
        print_summary(config["client_id"], results)
        if any(r.status == "error" for r in results):
            any_errors = True

    conn.close()
    print(f"\nCompleted: {date.today().isoformat()}")
    if any_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
