# Alert Notifications (WhatsApp)

## Why WhatsApp, and why Meta's own Cloud API

Chosen over Slack/email because that's where the agency and its clients
actually look first. Of the ways to send WhatsApp programmatically, we
used Meta's own **WhatsApp Business Cloud API** rather than a third party
(ConvertWay, Twilio): the agency already has a Meta Business Manager for
Ads, so this reuses that same account and its existing verification —
Twilio would mean a second, unrelated vendor relationship, and ConvertWay
doesn't currently expose a send-message API (only CSV campaign upload —
see docs/segments.md).

## Why alert detection and alert *sending* are two separate steps

`src/analytics/alerts.py` decides *whether* something is wrong and writes
a row to `alerts`. `src/notifications/dispatch.py` decides whether that
row has been *delivered* yet. Splitting these matters because they fail
independently: a correctly-detected revenue drop can still fail to send
(wrong phone number, WhatsApp API outage, template not yet approved)
without that meaning detection was wrong — and a send failure should be
retried on the next pipeline run, not silently lost or require
re-detecting the same alert.

This is why `alerts` gained a `notified_at` column
(`sql/013_alert_notifications.sql`) instead of sending inline the moment
an alert is inserted: `save_alerts()`/`save_sync_failure_alert()` already
upsert on every pipeline run to keep the message text current (see
docs/alerts.md), so sending at insert time would re-send the same alert
every single run on the same day. `send_pending_alerts()` instead queries
`WHERE notified_at IS NULL`, so an alert is sent exactly once (per client),
whenever it's first detected, no matter how many times the pipeline reruns
that day.

## Why templates, not free-form messages

WhatsApp only allows a business to send a free-form message within a
24-hour window after the recipient last messaged that business number.
An unattended daily pipeline can't rely on someone re-opening that window
every morning, so `src/notifications/whatsapp.py` always sends via the
**template** message type, which WhatsApp allows outside that window —
this is a platform rule, not a design choice we could avoid.

This means a message template (name configured in `config/whatsapp.yaml`
as `template_name`) must be created and **approved by Meta** ahead of time
in WhatsApp Manager, with exactly one body placeholder, e.g.:

```
Cogent Alert: {{1}}
```

`send_whatsapp_alert()` fills `{{1}}` with the alert's message text
(prefixed with the client_id, since one WhatsApp number/template serves
every client). Template approval is a one-time Meta review (usually
automatic for a plain "Utility"-category template), not something to
redo per client.

## Configuration split: agency-level sender vs. per-client recipients

Same shared-credential pattern as Meta Ads/GA4 (see docs/secrets.md):

- **`config/whatsapp.yaml`** — one shared sender for the whole agency
  (`phone_number_id`, `template_name`; the actual access token is a Vault
  secret, `agency.whatsapp.access_token`). Set up once, not per client.
- **Each client's `notifications.whatsapp_recipients`** in
  `config/clients/<id>.yaml` — plain E.164 phone numbers (not secret —
  useless to anyone without control of the agency's WhatsApp Business
  number itself), a list because more than one person on a client's or
  the agency's team may want alerts.

If `config/whatsapp.yaml` has no `phone_number_id` yet, or a client has no
`whatsapp_recipients`, the pipeline logs `WhatsApp notify: skipped` for
that reason — never an error, same as an unconfigured Shopify/Meta/GA4
source.

## Delivery semantics: all-recipients-or-retry, not partial success

If a client has multiple recipients and the send succeeds for one number
but fails for another (e.g. a typo'd number), the alert is **not** marked
`notified_at` — it's retried in full (all recipients) on the next pipeline
run. The person whose number worked gets a duplicate message on retry;
the alternative (marking it done after a partial failure) would mean the
person with the bad number never finds out at all. Given the choice
between an occasional duplicate and a silent miss, this project has
consistently chosen the former (same principle as never silently dropping
a customer row in segment exports, see docs/segments.md).

## Setup checklist

1. Meta Business Suite → WhatsApp Manager → add/verify a phone number
   under the same Business Manager used for Meta Ads.
2. Create a message template (category "Utility") with one body
   placeholder; wait for Meta's approval.
3. Generate a permanent access token for that WhatsApp Business Account
   (System User style, like the Meta Ads token).
4. `venv/Scripts/python scripts/set_vault_secret.py agency.whatsapp.access_token`
5. Fill in `phone_number_id` and `template_name` in `config/whatsapp.yaml`.
6. Add each client's recipient numbers to their
   `config/clients/<id>.yaml` under `notifications.whatsapp_recipients`.

## Not yet verified live

Built and wired into the orchestrator, but not yet exercised against a
real WhatsApp Business number/template — this account setup (Meta's
approval step in particular) needs the user to do the Meta Business Suite
side before a live send can be confirmed. Until then, this is the same
"verified only against documented API behavior" state the GA4 connector
started in (see docs/connectors.md) before we created a real testable
account for it.
