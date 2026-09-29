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
from src.ingestion.shopify_orders import sync_orders as sync_shopify_orders
from src.ingestion.meta_insights import sync_insights as sync_meta_insights
from src.ingestion.ga4_sessions import sync_sessions as sync_ga4_sessions
from src.transformations.shopify_orders import transform_orders
from src.reports.business_health_report import generate_report
from src.reports.storage import ensure_bucket_exists, upload_report
from src.analytics.alerts import check_metric_alerts, save_alerts, save_sync_failure_alert

load_dotenv()

OUTPUT_DIR = Path(__file__).resolve().parent.parent.parent / "reports" / "output"


@dataclass
class StepResult:
    step: str
    status: str  # "ok" | "skipped" | "error"
    detail: str


def run_for_client(conn, config: dict, since: str) -> list[StepResult]:
    client_id = config["client_id"]
    results: list[StepResult] = []

    store_domain = get_value(config, "shopify", "store_domain")
    shopify_token = resolve_secret(conn, config, "shopify", "access_token_secret")
    if store_domain and shopify_token:
        try:
            count = sync_shopify_orders(conn, client_id, store_domain, shopify_token, updated_at_min=since)
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
        generate_report(rows, config.get("display_name", client_id), str(output_path))
        results.append(StepResult("Report", "ok", f"{len(rows)} rows -> {output_path.name}"))

        supabase_url = os.environ.get("SUPABASE_URL")
        service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
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

    thresholds = get_value(config, "thresholds") or {}
    if not thresholds:
        results.append(StepResult("Alerts", "skipped", "no thresholds configured for this client"))
    elif len(rows) < 2:
        results.append(StepResult("Alerts", "skipped", "insufficient history (need at least 2 days)"))
    else:
        today_row, yesterday_row = rows[-1], rows[-2]
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
    args = parser.parse_args()

    since = (date.today() - timedelta(days=args.days)).isoformat()
    started_at = date.today().isoformat()

    print(f"D2C ANALYTICS PIPELINE\n{'-' * 22}\nStarted: {started_at} (syncing since {since})")

    conn = psycopg2.connect(os.environ["DATABASE_URL"])
    clients = load_all()

    if not clients:
        print("No clients found in config/clients/*.yaml -- nothing to do.")
        return

    any_errors = False
    for config in clients:
        results = run_for_client(conn, config, since)
        print_summary(config["client_id"], results)
        if any(r.status == "error" for r in results):
            any_errors = True

    conn.close()
    print(f"\nCompleted: {date.today().isoformat()}")
    if any_errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
