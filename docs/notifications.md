# Alert Notifications (WhatsApp)

## Why WhatsApp, and why Twilio (switched from Meta)

Chosen over Slack/email because that's where the agency and its clients
actually look first. Originally built on Meta's own WhatsApp Business
Cloud API, reusing the agency's existing Meta Business Manager — switched
to **Twilio** because testing needed a WhatsApp-enabled phone number
verified in that Business Manager, which wasn't available yet. Twilio
provides a free **Sandbox** number that works immediately for development
(join via a code, no business verification step) — though as the section
below explains, "works immediately" turned out to need more than was
first assumed; the send functions still need a real code change (not
just new config values) before either the Sandbox or a real sender will
actually deliver a message.

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

## Templates required -- correction from an earlier wrong assumption

This doc originally claimed Twilio's Sandbox accepts plain free-form
`Body` text with no template, unlike Meta. **That was wrong, found out
during live testing, not assumed away a second time:** sending a
`Body`-only message to the Sandbox fails with Twilio error 21654
("ContentSid Required"), even with an open 24-hour session window with
the recipient. The real rule, confirmed against Twilio's own docs: **the
Sandbox only accepts outbound messages built from one of Twilio's 3
pre-built Content Templates**, referenced by `ContentSid` (+
`ContentVariables` for the template's placeholders) — never a raw `Body`
string. `send_whatsapp_alert()` currently still sends `Body`-only and
**will fail every time against the Sandbox** until this is fixed.

This is a stricter version of the same constraint Meta always had
(template required outside a session window) — Twilio's Sandbox just
narrows it further to "always, even inside a session window, and only
from a fixed set of 3 generic templates you can't customize the wording
of." A **real** (non-Sandbox) Twilio WhatsApp sender uses Twilio's own
Content Template Builder instead, where you can create and get approved
a template with whatever wording the alert/DHR messages actually need
(the way the original Meta design was built) — that's the real path
forward once a verified production number exists, not the Sandbox's 3
fixed demo templates.

**Status: paused.** Testing is on hold until a real verified number is
available (user's decision) — `send_whatsapp_alert()`/`send_whatsapp_media()`
are not yet updated for the ContentSid requirement, since what a real
sender's approved template will look like isn't decided yet either.

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
   (the Auth Token, next to Account SID on the console dashboard) — run
   this yourself in your own terminal, never paste the token into a chat
   with Claude; the hidden `getpass` prompt is designed exactly to avoid
   that.
5. Add each client's recipient numbers from the admin **Clients** page in
   the web UI (not a YAML file — see "Alert thresholds and WhatsApp
   recipients now live in the database" in docs/secrets.md).

## Status: live-tested, paused pending a real number

Account SID / Auth Token / config loading all verified working live --
`load_whatsapp_config()` correctly resolves a real Vault secret and
connects. The actual **send** is blocked, not by configuration, but by
the ContentSid requirement above (`send_whatsapp_alert()` needs a real
code change first). Per the user's decision, further testing is paused
until a real verified WhatsApp sender (not the Sandbox) is available --
at that point, both the code fix and a real approved Content Template
need to happen together, not the Sandbox's 3 fixed demo templates.
