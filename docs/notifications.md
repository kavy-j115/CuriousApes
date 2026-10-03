# Notifications and the WhatsApp bot (Meta Cloud API)

Alerts, the daily report and the report bot all use Meta's WhatsApp Business
Cloud API directly, with the company's own verified number. (Twilio was
replaced.)

## What clients get

1. **Daily push** -- after each pipeline run, every number registered on a
   client receives that brand's month-to-date report as a PNG.
2. **Ask the bot** -- anyone on a registered number can message the bot:
   `report` (month to date), `yesterday`, `7 days`. The bot replies with the
   stored picture. A number on several brands is asked which brand.
3. **Alerts** -- text alerts (anomalies, sync failures) to the same numbers.

**Who sees what:** only the numbers an admin registered for a client (Clients
page -> WhatsApp recipients, `clients.whatsapp_recipients`). What a sender
types never grants access. Unregistered numbers get a "not registered" reply.

## How it works

- `src/reports/report_image.py` draws the table (same columns, Total row, header
  colour and PROAS colour scale as the Excel report).
- Each pipeline run (`src/reports/whatsapp_reports.py`) renders three views --
  `mtd`, `7d`, `yesterday` -- to Supabase Storage `<client>/png/<view>.png`,
  then pushes `mtd` to the client's numbers.
- The bot is `web/src/app/api/whatsapp/webhook` (+ `web/src/lib/whatsappBot.ts`).
  It checks Meta's signature, finds the brand from the sender's number, and
  sends a signed link to the stored PNG. Nothing is rendered on demand.

## Templates

Messages we start (alerts, daily push) must use approved templates; replies
inside 24h of a client's message are free-form (bot replies need no template).
Create in WhatsApp Manager, category **Utility**, language English:

| Template (default name) | Content | Used for |
|---|---|---|
| `alert_notification` | body `Curious Apes alert: {{1}}` | alerts |
| `daily_report_image` | header = **Image** (sample image), body `{{1}} Reply "report", "yesterday" or "7 days" for more.` | daily push |

## Config

- `config/whatsapp.yaml` (committed, nothing secret): `phone_number_id`,
  `display_number`, template names, language. Blank `phone_number_id` =
  disabled (pipeline skips sending, not an error).
- Vault secrets (`scripts/set_vault_secret.py <name>`):
  `agency.whatsapp.access_token`, `agency.whatsapp.app_secret`,
  `agency.whatsapp.verify_token` (any random string you choose).
- Netlify env var `WHATSAPP_PHONE_NUMBER_ID` (same value as the yaml).

## One-time setup

1. Remove the number from the WhatsApp / WhatsApp Business app.
2. Meta Business Settings -> WhatsApp accounts -> create a WABA under the
   Business Portfolio; add the number, set the display name (needs approval),
   verify by SMS/voice code.
3. Start business verification (lifts the sending limits).
4. System User with `whatsapp_business_messaging` + `whatsapp_business_management`,
   WABA assigned with full control, token with no expiry -> Vault.
5. Create the two templates above; wait for approval.
6. Meta app (developers.facebook.com) -> WhatsApp -> Configuration -> Webhook:
   callback URL `<SITE_URL>/api/whatsapp/webhook`, verify token = the Vault
   `verify_token`; subscribe to the **messages** field. App secret (App settings
   -> Basic) -> Vault `app_secret`.
7. Put the Phone number ID in `config/whatsapp.yaml` and Netlify, deploy.
8. Add each client's numbers on the Clients page.
