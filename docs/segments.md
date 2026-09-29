# Customer Segments & Campaign Export

## What this is (and isn't)

A tool to simplify the manual "export from Shopify → clean → segment →
format for ConvertWay" process described in the original request —
**deliberately not full automation**. It produces a ready-to-upload CSV;
you still review it and upload it to ConvertWay yourself. Pushing directly
to ConvertWay's own API is a separate, bigger step not built here.

## The `customers` table

Added because segment logic needs customer-level data (phone, name), which
previously only lived buried inside `orders`' raw JSONB. One customer has
many orders, so this is a dedicated table (`sql/007_customers.sql`) rather
than columns duplicated onto every order row — same reasoning as
`order_line_items` vs. `orders`. Populated by
`src/transformations/shopify_orders.py`'s `_upsert_customer()`, run
alongside the existing order transformation.

`src/connectors/shopify.py`'s `ORDERS_QUERY` was extended to fetch
`phone`, `firstName`, `lastName` on the customer object — previously only
`email` and `numberOfOrders` were pulled.

## Segments built so far

`src/analytics/customer_segments.py`:
- **`get_customers_by_last_order_window(conn, client_id, min_days_ago, max_days_ago)`**
  — "hasn't ordered in X-Y days" win-back segments. Finds each customer's
  most recent order and checks whether it falls in the window. Verified
  against synthetic data (10/75/100 days ago) — correctly included only
  the 75-day customer, excluded the too-recent and too-old ones.

More segment types (e.g. a Diwali-specific date window, top spenders) can
be added as additional functions returning the same customer dict shape,
feeding the same export function below.

## ConvertWay export

`src/reports/convertway_export.py` writes a CSV matching ConvertWay's exact
upload format (`phone, email, first name, last name, country code` —
verified against a real sample file). Two things worth understanding:

- **Phone splitting uses `phonenumbers`** (Google's libphonenumber), not
  hand-rolled string slicing. Shopify stores a combined number like
  `+919050111111`; ConvertWay wants it split into `phone` (national
  number) and `country code` separately. Country codes aren't a fixed
  length (`1`, `91`, `971`...), so slicing by a fixed number of characters
  would silently produce wrong splits for some countries — a real library
  that actually parses the number is the correct tool here, not a shortcut.
- **Never silently drops a customer.** A customer with no phone, or a
  phone that doesn't parse as valid, is skipped and counted separately
  (`skipped_no_phone` / `skipped_invalid_phone`) rather than just vanishing
  from the output with no explanation — same "never hide a data problem"
  principle as everywhere else in this project.

## Running it

```
venv/Scripts/python scripts/export_segment_convertway.py --client dev_test --min-days 60 --max-days 90
```

Writes to `reports/output/segments/<client>_winback_<min>_<max>d.csv` and
prints a summary (matched / exported / skipped-with-reason counts).

## Verified

Segment query and CSV export both verified against synthetic multi-customer
data with a mix of qualifying/non-qualifying/no-phone customers — exact
expected set matched, exact expected skip counts produced. Also run against
real `dev_test` data (0 matches, since our only test order was placed
today, not 60-90 days ago) — confirmed the empty-result path still writes
a valid CSV with the correct header, not a crash or a malformed file.

## Not built yet

The Diwali-style "message drafting" half of the original request (AI-
assisted campaign copy) — a separate feature, not yet started.
