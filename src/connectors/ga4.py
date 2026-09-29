"""Google Analytics 4 (GA4) Data API connector.

UNVERIFIED AGAINST A LIVE ACCOUNT -- see docs/connectors.md. Written against
GA4's documented request/response shape, no real property access exists yet.
This is the first connector in the project built this way; treat it as more
likely to need a fix once real credentials arrive than Shopify or Meta were.

Auth: a Service Account JSON key, passed in as an already-parsed dict
(google-auth handles the JWT signing and token refresh -- see the module
docstring in requirements.txt for why we use the library here instead of
everywhere else). Deliberately takes a dict, not a file path -- the key
lives in Supabase Vault as text and is json.loads()'d by the caller, so
it's never written to disk at all.
"""

import requests
from google.oauth2 import service_account
from google.auth.transport.requests import Request as GoogleAuthRequest

API_URL_TEMPLATE = "https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport"
SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

# Event counts, not deduplicated per-session -- see module docstring and
# docs/connectors.md for why "sessions with a cart addition" needs a second,
# differently-shaped query that isn't built yet.
METRICS = ["sessions", "addToCarts", "checkouts", "transactions"]


def _access_token(service_account_info: dict) -> str:
    credentials = service_account.Credentials.from_service_account_info(
        service_account_info, scopes=SCOPES
    )
    credentials.refresh(GoogleAuthRequest())
    return credentials.token


def fetch_daily_ecommerce_metrics(property_id: str, service_account_info: dict, since: str, until: str):
    """Yields one raw row dict per day in [since, until], each shaped like:
    {"date": "20260901", "sessions": 123, "addToCarts": 40, "checkouts": 12, "transactions": 5}

    since/until: 'YYYY-MM-DD' strings.
    """
    token = _access_token(service_account_info)

    response = requests.post(
        API_URL_TEMPLATE.format(property_id=property_id),
        headers={"Authorization": f"Bearer {token}"},
        json={
            "dateRanges": [{"startDate": since, "endDate": until}],
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": m} for m in METRICS],
        },
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()

    for row in body.get("rows", []):
        yield _parse_row(row)


def _parse_row(row: dict) -> dict:
    """GA4 returns dimensionValues/metricValues as parallel positional lists,
    not a keyed object -- we zip them back into a dict ourselves."""
    parsed = {"date": row["dimensionValues"][0]["value"]}  # 'YYYYMMDD'
    for metric_name, value in zip(METRICS, row["metricValues"]):
        parsed[metric_name] = int(value["value"])
    return parsed
