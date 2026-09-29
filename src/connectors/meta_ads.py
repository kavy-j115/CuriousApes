"""Meta Marketing API connector (Ads Insights).

Auth via a Business Manager System User token (long-lived, meant for
unattended jobs) -- see docs/connectors.md for why this differs from a
normal user token.
"""

import time

import requests

API_VERSION = "v21.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

INSIGHTS_FIELDS = "spend,actions,action_values,purchase_roas,impressions,clicks"


def fetch_daily_insights(ad_account_id: str, access_token: str, since: str, until: str):
    """Yields one raw insight dict per day in [since, until] (inclusive), account-level.

    since/until: 'YYYY-MM-DD' strings.
    """
    url = f"{BASE_URL}/act_{ad_account_id}/insights"
    params = {
        "fields": INSIGHTS_FIELDS,
        "time_range": f'{{"since":"{since}","until":"{until}"}}',
        "time_increment": 1,  # one row per day, instead of one row for the whole range
        "level": "account",
        "access_token": access_token,
    }

    while url:
        response = requests.get(url, params=params, timeout=30)
        response.raise_for_status()
        body = response.json()

        _respect_rate_limit(response)

        for row in body["data"]:
            yield row

        # Meta paginates via a full "next" URL rather than a cursor token --
        # once we follow it, params are already baked into the URL itself.
        url = body.get("paging", {}).get("next")
        params = None


def _respect_rate_limit(response: requests.Response) -> None:
    usage_header = response.headers.get("x-business-use-case-usage")
    if not usage_header:
        return
    import json

    try:
        usage = json.loads(usage_header)
        max_pct = max(
            entry.get("call_count", 0)
            for entries in usage.values()
            for entry in entries
        )
        if max_pct > 90:
            time.sleep(5.0)
    except (ValueError, KeyError):
        pass  # header shape not what we expected -- don't let this break the sync


def extract_action_metric(actions: list | None, action_type: str = "purchase") -> float:
    """Meta returns actions as a list of {action_type, value} dicts rather than
    fixed fields. Pulls the value for one specific action_type, or 0 if absent."""
    if not actions:
        return 0.0
    for entry in actions:
        if entry.get("action_type") == action_type:
            return float(entry["value"])
    return 0.0
