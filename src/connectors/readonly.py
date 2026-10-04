"""House rule: Meta and Shopify are READ-ONLY for this platform. Anything that is not a
read (create, update, delete, subscribe, uninstall) happens only in our own database.

This module is the runtime half of that rule; scripts/check_read_only.py is the
static half (it scans the code). Message sending over WhatsApp and the OAuth token
exchanges that authorize our read access are the only calls to those companies that
are not plain reads, and they are listed explicitly in the checker.
"""

import re

_WRITING_OPERATION = re.compile(r"^\s*(mutation|subscription)\b", re.IGNORECASE)


# The one permitted exception (approved by the owner, to be tested on a live store):
# Shopify's bulk EXPORT. It is spelled as a mutation but only asks Shopify to prepare a
# file of orders that we then download -- it changes nothing in the store. Anything else
# written as a mutation, including this call combined with another one, is refused.
_BULK_EXPORT = (
    "mutation($q: String!) { bulkOperationRunQuery(query: $q) { "
    "bulkOperation { id status } userErrors { field message } } }"
)


def require_read_only_graphql(document: str) -> None:
    """Refuses any GraphQL document that is not a plain query (or the bulk export)."""
    stripped = re.sub(r"#.*", "", document)  # drop comments
    if " ".join(stripped.split()) == _BULK_EXPORT:  # exactly this document, nothing more
        return
    if _WRITING_OPERATION.match(stripped):
        raise PermissionError("Shopify is read-only for this platform: GraphQL mutations are not allowed.")
