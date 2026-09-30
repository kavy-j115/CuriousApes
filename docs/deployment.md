# Deployment (Netlify)

## Setup

1. In Netlify: **Add new site → Import an existing project**, connect the
   GitHub repo.
2. **Base directory**: `web` (the Next.js app isn't at the repo root --
   `netlify.toml` in `web/` already sets this, but Netlify's UI asks too
   during setup).
3. Build command / publish directory are read from `web/netlify.toml` --
   no need to set them manually in the UI.
4. Add every environment variable below in **Site settings → Environment
   variables** before the first deploy (a build without them won't fail
   loudly -- pages will just 500 or silently show empty data at runtime).

## Required environment variables

Same values as `web/.env.local` locally -- see `web/.env.local.example`
for what each one is and why it's needed:

| Variable | Exposed to browser? |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes |
| `NEXT_PUBLIC_RETENTION_DASHBOARD_URL` | yes (optional -- Retention link is dead without it) |
| `SUPABASE_URL` | **no** -- server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** -- server-only, highly sensitive |

## Known risk: System Settings' config file reads

`dashboard/admin/settings/page.tsx` reads `config/clients/*.yaml` and
`config/whatsapp.yaml` directly off the filesystem (`node:fs`), since
that's where the Python pipeline's config already lives -- fine locally,
where both the web app and the Python repo share one checkout.

**This is not guaranteed to work on Netlify.** Netlify's Next.js runtime
bundles the `web/` app into its own function; whether `config/` (a
directory outside `web/`, in the Python side of the repo) is included in
that bundle is not something we've verified. If it isn't, that one page
shows "Couldn't read config files" (it already has a try/catch for
exactly this) -- everything else in the app is unaffected, since no other
page reads the filesystem this way.

**After the first deploy, check this page specifically.** If it's broken,
the fix is either: get the config directory included in the function
bundle (Netlify's `included_files` build setting), or move this page to
read from the database instead of the filesystem -- not done now since it
couldn't be verified without an actual deployed Netlify environment to
test against.

## Not yet verified

This file documents the intended setup; the actual deployment hasn't been
run yet (the user chose to deploy it themselves rather than have this done
end-to-end here). Once deployed, worth re-checking: the auth redirect flow
(`proxy.ts`) works correctly behind Netlify's edge, and the three login
themes/role-mismatch rejection still behave the same in production as in
local dev.
