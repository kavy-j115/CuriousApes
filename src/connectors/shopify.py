"""Shopify Admin GraphQL API connector.

Talks to exactly one store per call (store_domain + access_token are passed
in, not read from global config) — this keeps the connector reusable across
multiple client brands without knowing about our client/config system at all.
"""

import json
import threading
import time

import requests

from src.connectors.readonly import require_read_only_graphql

API_VERSION = "2024-10"

ORDERS_QUERY = """
query Orders($cursor: String, $queryFilter: String) {
  orders(first: 50, after: $cursor, query: $queryFilter, sortKey: CREATED_AT) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        currentSubtotalPriceSet { shopMoney { amount currencyCode } }
        totalDiscountsSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        customer { id email phone firstName lastName numberOfOrders }
        lineItems(first: 50) {
          edges {
            node {
              id
              title
              sku
              quantity
              originalUnitPriceSet { shopMoney { amount currencyCode } }
            }
          }
        }
      }
    }
  }
}
"""


class ShopifyGraphQLError(Exception):
    pass


def _endpoint(store_domain: str, api_version: str = API_VERSION) -> str:
    return f"https://{store_domain}/admin/api/{api_version}/graphql.json"


def _post(store_domain: str, access_token: str, query: str, variables: dict, api_version: str = API_VERSION) -> dict:
    require_read_only_graphql(query)  # house rule: Shopify is read-only for us
    response = requests.post(
        _endpoint(store_domain, api_version),
        json={"query": query, "variables": variables},
        headers={
            "X-Shopify-Access-Token": access_token,
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    response.raise_for_status()
    body = response.json()

    if "errors" in body:
        raise ShopifyGraphQLError(body["errors"])

    # Cost-based rate limiting: back off if we're close to the bucket limit.
    cost = body.get("extensions", {}).get("cost")
    if cost:
        throttle = cost["throttleStatus"]
        if throttle["currentlyAvailable"] < cost["requestedQueryCost"] * 2:
            time.sleep(1.0)  # let the bucket refill (restores ~50 points/sec)

    return body["data"]


BULK_START = """
mutation($q: String!) {
  bulkOperationRunQuery(query: $q) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
"""

BULK_STATUS = """
query { currentBulkOperation(type: QUERY) { id status errorCode objectCount url } }
"""

# The same fields as ORDERS_QUERY, but with no page sizes: Shopify prepares the whole
# result as one file. Line items come back as their own lines (linked to the order by
# __parentId) and are stitched back together below.
_BULK_INNER = """
{
  orders(query: %s, sortKey: CREATED_AT) {
    edges { node {
      id name createdAt updatedAt displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      currentSubtotalPriceSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      totalRefundedSet { shopMoney { amount currencyCode } }
      customer { id email phone firstName lastName numberOfOrders }
      lineItems { edges { node {
        id title sku quantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
      } } }
    } }
  }
}
"""

_BULK_LOCK = threading.Lock()  # clients run in parallel; the bulk export is not: one at a time


def fetch_orders_bulk(store_domain: str, access_token: str, created_at_min: str, timeout_s: int = 1500):
    """Same orders as fetch_orders, but through Shopify's bulk export: one request
    asks Shopify to prepare every matching order as a single file, which we download.
    Only one bulk export is in flight at any moment (lock); the orders are handed
    out after it is released. Raises if the export fails or times out (the caller
    falls back to paging)."""
    with _BULK_LOCK:
        orders = list(_run_bulk_export(store_domain, access_token, created_at_min, timeout_s))
    yield from orders


def _run_bulk_export(store_domain: str, access_token: str, created_at_min: str, timeout_s: int):
    inner = _BULK_INNER % json.dumps(f"created_at:>='{created_at_min}'")
    deadline = time.monotonic() + timeout_s
    while True:  # Shopify also allows just one export per store at a time
        data = _post(store_domain, access_token, BULK_START, {"q": inner})["bulkOperationRunQuery"]
        if not data["userErrors"]:
            break
        if "already in progress" not in json.dumps(data["userErrors"]).lower() or time.monotonic() > deadline:
            raise ShopifyGraphQLError(data["userErrors"])
        time.sleep(5)

    delay = 2.0
    while True:
        op = _post(store_domain, access_token, BULK_STATUS, {})["currentBulkOperation"]
        if op and op["status"] == "COMPLETED":
            break
        if op and op["status"] in ("FAILED", "CANCELED", "CANCELING", "EXPIRED"):
            raise ShopifyGraphQLError(f"bulk export {op['status']}: {op.get('errorCode')}")
        if time.monotonic() > deadline:
            raise ShopifyGraphQLError("bulk export timed out")
        time.sleep(delay)
        delay = min(delay * 1.5, 10.0)

    if not op["url"]:  # no orders matched: Shopify gives no file
        return

    orders: dict[str, dict] = {}
    with requests.get(op["url"], stream=True, timeout=120) as response:
        response.raise_for_status()
        for line in response.iter_lines():
            if not line:
                continue
            row = json.loads(line)
            parent = row.pop("__parentId", None)
            if parent is None:
                row["lineItems"] = {"edges": []}
                orders[row["id"]] = row
            elif parent in orders:
                orders[parent]["lineItems"]["edges"].append({"node": row})
    yield from orders.values()


def fetch_orders(store_domain: str, access_token: str, created_at_min: str | None = None):
    """Yields raw order dicts (one per Shopify order), handling pagination.

    created_at_min: a date or ISO 8601 timestamp. When set, only orders CREATED
    on or after it are returned -- so a run covers exactly the order dates
    asked for and lines up with what Shopify's own reports show. (This used
    to filter on updated_at, which pulled in old orders that merely changed
    recently and left older days only partially filled.)
    """
    query_filter = f"created_at:>='{created_at_min}'" if created_at_min else None
    cursor = None

    while True:
        data = _post(
            store_domain,
            access_token,
            ORDERS_QUERY,
            {"cursor": cursor, "queryFilter": query_filter},
        )
        orders = data["orders"]

        for edge in orders["edges"]:
            yield edge["node"]

        page_info = orders["pageInfo"]
        if not page_info["hasNextPage"]:
            break
        cursor = page_info["endCursor"]
