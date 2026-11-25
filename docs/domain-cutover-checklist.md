# Domain cutover checklist: https://app.curiousapes.in

The code has no hardcoded URL; it reads `SITE_URL`. Everything below is configuration in other
consoles. Do steps 3 to 6 together, once step 2 shows the app answering on HTTPS.
Write `<site>` = `https://app.curiousapes.in` (no trailing slash).

## 1. GoDaddy DNS
- [ ] `A` record: host `app`, value = the new Droplet's IP (not the website Droplet 143.110.240.161).
- [ ] Check: `nslookup app.curiousapes.in` returns the new Droplet's IP.

## 2. Droplet
- [ ] Caddyfile site address is `app.curiousapes.in` (done).
- [ ] App env file has `SITE_URL=<site>`; restart the app (pm2 or systemd).
- [ ] Check: `<site>/login` loads over HTTPS with a valid certificate.

## 3. Shopify app version (Dev Dashboard)
- [ ] App URL: `<site>/api/shopify/install`
- [ ] Allowed redirection URL: `<site>/api/shopify/callback`
- [ ] Webhooks (compliance + `app/uninstalled`): `<site>/api/shopify/webhooks`
- [ ] Listing: privacy `<site>/privacy`, support `<site>/support`
- [ ] Scopes: paste the list from `DEFAULT_SCOPES` in `web/src/lib/shopifyConfig.ts`; "Embed app in Shopify admin" ticked.
- [ ] Release the app version.

## 4. Meta app
- [ ] Facebook Login, valid OAuth redirect URI: `<site>/api/meta/callback`
- [ ] App settings: add `app.curiousapes.in` to App domains; privacy policy URL `<site>/privacy`
- [ ] WhatsApp, Configuration, webhook callback URL: `<site>/api/whatsapp/webhook` (verify token unchanged)

## 5. Supabase Auth
- [ ] Authentication, URL Configuration: Site URL = `<site>`
- [ ] Redirect URLs: add `<site>/**`

## 6. cron-job.org / scheduler
- [ ] If the daily run is the Droplet's systemd timer, delete the cron-job.org job (otherwise it double-runs and double-sends).
- [ ] Otherwise update the job URLs to the new domain.

## 7. Final checks
- [ ] Log in at `<site>/login`; password-change and redirects work.
- [ ] Open the install link for a test store; it reaches Shopify's authorize page and returns to `<site>/api/shopify/callback`.
- [ ] Send a WhatsApp message to the bot; it replies.
- [ ] Netlify no longer serves anything we rely on (the old curiousapes.netlify.app can be retired).
