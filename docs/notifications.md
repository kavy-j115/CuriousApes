# Alert Notifications (WhatsApp)

## Why WhatsApp, and why Twilio (switched from Meta)

Chosen over Slack/email because that's where the agency and its clients
actually look first. Originally built on Meta's own WhatsApp Business
Cloud API, reusing the agency's existing Meta Business Manager — switched
to **Twilio** because testing needed a WhatsApp-enabled phone number
verified in that Business Manager, which wasn't available yet. Twilio
provides a free **Sandbox** number that works immediately for development
(join via a code, no business verification step), unblocking testing now;
a real approved Twilio WhatsApp sender can replace the sandbox later with
no code change, just new config values.

## Why alert detection and alert *sending* are two separate steps

`src/analytics/alerts.py` decides *whether* something is wrong and writes
a row to `alerts`. `src/notifications/dispatch.py` decides whether that
row has been *delivered* yet. Splitting these matters because they fail
independently: a correctly-detected revenue drop can still fail to send
(wrong phone number, WhatsApp API outage) without that meaning detection
was wrong — and a send failure should be retried on the next pipeline
run, not silently lost or require re-detecting the same alert.

This is why `alerts` gained a `notified_at` column
(`sql/013_alert_notifications.sql`) instead of sending inline the moment
an alert is inserted: `save_alerts()`/`save_sync_failure_alert()` already
upsert on every pipeline run to keep the message text current (see
docs/alerts.md), so sending at insert time would re-send the same alert
every single run on the same day. `send_pending_alerts()` instead queries
`WHERE notified_at IS NULL`, so an alert is sent exactly once (per client),
whenever it's first detected, no matter how many times the pipeline reruns
that day.

## Free-form text, for now

Meta's WhatsApp API requires a pre-approved message template to send
outside a 24-hour customer-service window — a real platform constraint an
unattended daily job can't work around. Twilio's **Sandbox** doesn't have
that restriction; it accepts plain free-form text, which is why
`send_whatsapp_alert()` just sends the alert message directly, no
template involved.

**This changes once the sandbox is replaced with a real approved WhatsApp
sender** (Twilio's own production WhatsApp Business API has the same
template requirement Meta's does, via Twilio Content Templates) — that's
a real constraint to revisit before relying on this for production
alerting, not something this switch avoided permanently.

## Configuration split: agency-level sender vs. per-client recipients

Same shared-credential pattern as Meta Ads/GA4 (see docs/secrets.md):

- **`config/whatsapp.yaml`** — one shared sender for the whole agency
  (`account_sid`, `from_number`; the actual auth token is a Vault secret,
  `agency.whatsapp.auth_token`). Set up once, not per client.
- **Each client's `notifications.whatsapp_recipients`** in
  `config/clients/<id>.yaml` — plain E.164 phone numbers (not secret —
  useless to anyone without control of the agency's Twilio account
  itself), a list because more than one person on a client's or the
  agency's team may want alerts. **Sandbox-specific requirement:** each
  recipient number must first send the sandbox's join code to the sandbox
  number via WhatsApp, once, before Twilio will deliver messages to it —
  not needed once a real sender replaces the sandbox.

If `config/whatsapp.yaml` has no `account_sid`/`from_number` yet, or a
client has no `whatsapp_recipients`, the pipeline logs
`WhatsApp notify: skipped` for that reason — never an error, same as an
unconfigured Shopify/Meta/GA4 source.

## Delivery semantics: all-recipients-or-retry, not partial success

If a client has multiple recipients and the send succeeds for one number
but fails for another (e.g. a typo'd number, or a number that never
joined the sandbox), the alert is **not** marked `notified_at` — it's
retried in full (all recipients) on the next pipeline run. The person
whose number worked gets a duplicate message on retry; the alternative
(marking it done after a partial failure) would mean the person with the
bad number never finds out at all. Given the choice between an occasional
duplicate and a silent miss, this project has consistently chosen the
former (same principle as never silently dropping a customer row in
segment exports, see docs/segments.md).

## Setup checklist

1. Sign up / log in at twilio.com; copy the **Account SID** from the
   console dashboard into `account_sid` in `config/whatsapp.yaml`.
2. Console → Messaging → Try it out → Send a WhatsApp message — gives a
   **Sandbox number** (usually `+14155238886`) and a join code. Put the
   sandbox number in `from_number`.
3. Each recipient sends the join code to the sandbox number via WhatsApp
   once (a one-time sandbox requirement per phone number).
4. `venv/Scripts/python scripts/set_vault_secret.py agency.whatsapp.auth_token`
   (the Auth Token, next to Account SID on the console dashboard).
5. Add each client's recipient numbers to their
   `config/clients/<id>.yaml` under `notifications.whatsapp_recipients`.

## Not yet verified live

Built and wired into the orchestrator, but not yet exercised against a
real Twilio sandbox send — needs the user to complete the Twilio console
setup above (account creation, sandbox join) before a live send can be
confirmed. Until then, this is the same "verified only against documented
API behavior" state the GA4 connector started in (see docs/connectors.md)
before a real testable account existed for it.
