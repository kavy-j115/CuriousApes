"""Shopify Admin GraphQL API connector.

Talks to exactly one store per call (store_domain + access_token are passed
in, not read from global config) — this keeps the connector reusable across
multiple client brands without knowing about our client/config system at all.
"""

import time

import requests

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


def _endpoint(store_domain: str) -> str:
    return f"https://{store_domain}/admin/api/{API_VERSION}/graphql.json"


def _post(store_domain: str, access_token: str, query: str, variables: dict) -> dict:
    response = requests.post(
        _endpoint(store_domain),
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
