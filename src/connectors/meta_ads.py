"""Meta Marketing API connector (Ads Insights).

Auth via a Business Manager System User token (long-lived, meant for
unattended jobs) -- see docs/connectors.md for why this differs from a
normal user token. Sent via the Authorization header, not a URL query
parameter -- a token in a URL ends up in error messages, server logs, and
browser history; a header does not (matches how the Shopify connector
already does this via X-Shopify-Access-Token). Also sanitizes any URL
before it can appear in an error message, as defense in depth regardless
of how it got there -- e.g. Meta's own pagination "next" URLs, whose exact
shape we don't control.
"""

import re
import time

import requests

API_VERSION = "v21.0"
BASE_URL = f"https://graph.facebook.com/{API_VERSION}"

INSIGHTS_FIELDS = "spend,actions,action_values,purchase_roas,impressions,clicks"


def _sanitize_url(url: str) -> str:
    return re.sub(r"([?&]access_token=)[^&]+", r"\1REDACTED", url)


def _request(url: str, access_token: str, params: dict | None) -> requests.Response:
    response = requests.get(
        url,
        params=params,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30,
    )
    try:
        response.raise_for_status()
    except requests.HTTPError as e:
        # Re-raise with the URL sanitized and Meta's actual error body included
        # (the default exception has neither -- it has the raw URL and no body).
        safe_url = _sanitize_url(response.request.url or url)
        raise requests.HTTPError(
            f"{response.status_code} error for {safe_url}: {response.text}"
        ) from None
    return response


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
    }

    while url:
        response = _request(url, access_token, params)
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
