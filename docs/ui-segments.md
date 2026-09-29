# Segment Export UI (`/segments`)

The browser-based version of `docs/segments.md`'s ConvertWay export —
built into the UI so this doesn't require the command line. Reachable
from the main dashboard via "Segment Export →".

## Why entirely client-side

The file never leaves the browser — no server upload, not even to our own
backend. Parsing, recipe logic, and CSV generation all run in
`src/lib/segmentRecipes.ts`, executed in the browser via
`FileReader`/`Blob`. This was a deliberate choice, not the default: it
means customer PII (phone numbers, emails, addresses) never touches any
server, works identically on Netlify with zero backend function needed,
and has no dependency on our database or on the client already existing
in `config/clients/*.yaml` — any raw Shopify export can be processed, sync
history required.

## Why two different source files, not one

Confirmed directly from real exports (not assumed):

- **Customers export** has Shopify's own pre-aggregated `Total Spent` and
  `Total Orders` per customer, but **no date information at all**. Good
  for Repeat Customers (`Total Orders >= N`) and High AOV
  (`Total Spent / Total Orders >= threshold`).
- **Orders export** has the actual order dates, but is genuinely messier:
  it's one row per **line item**, not per order — a multi-item order
  repeats `Name`/`Email`/`Created at` on every row but leaves order-level
  fields (`Total`, `Phone`, etc.) blank on every row after the first.
  Needed for Win-back/Inactive ("last order was X-Y days ago"), which
  Customers export can't answer at all.

`looksLikeCustomersExport()`/`looksLikeOrdersExport()` check the uploaded
file's headers and warn if it doesn't match what the selected recipe
needs, rather than silently processing the wrong file type and producing
a confusing empty or wrong result.

## A real bug this caught

The customer export's `Phone` column is specifically the
SMS-marketing-consented number and is usually **blank**; the actual
checkout/address phone lives in `Default Address Phone`. First version of
the code only read `Phone` and skipped every single customer as
"no_phone" — caught by testing against real exported data rather than
trusting the code because it type-checked and ran without error. Fixed to
read `Phone` first, falling back to `Default Address Phone`.

Also: Shopify prefixes ID/phone columns in its CSV exports with a literal
single-quote character (e.g. a cell containing the text `'9930023314`) to
stop spreadsheet apps from mangling large numbers — stripped before
parsing.

## Verified

All three recipes run against the real `customers_export.csv` and
`orders_export.csv` files supplied, via a throwaway Node script
(`npx tsx`, deleted after) calling the exact same functions the UI uses —
not separate test logic. Repeat Customers and High AOV counts were
spot-checked by hand against the raw CSV. The full browser upload flow
(file input -> FileReader -> recipe -> download) was then confirmed
directly by the user for the Repeat Customers recipe.

## Not built yet

The message-drafting half of the original request (AI-assisted campaign
copy) -- separate feature, not started.
