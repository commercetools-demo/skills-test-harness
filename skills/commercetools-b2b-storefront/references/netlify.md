# Deploy to Netlify

How to provision a new Netlify site and configure it for this B2B storefront.

## Prerequisites

1. **Netlify personal access token** — generate at app.netlify.com → Personal access tokens
2. **Storefront CT API credentials** — the `b2b-site/.env` values (the **Frontend B2B** API client with limited scope). **Never use admin/`manage_project` credentials here.**
3. **A unique site name** — will become `https://<name>.netlify.app`
4. **`netlify.toml`** — already present in the repo root; no changes needed

## Step 1 — Run the setup script

```bash
node tools/netlify-setup.mjs
```

The script prompts for:

| Prompt | Notes |
|--------|-------|
| Netlify personal access token | Or set `NETLIFY_AUTH_TOKEN` in shell to skip |
| Site name | Must be unique across Netlify (e.g. `acme-b2b`) |
| `CTP_PROJECT_KEY` | commercetools project key |
| `CTP_CLIENT_ID` | Storefront API client ID |
| `CTP_CLIENT_SECRET` | Storefront API client secret |
| `CTP_AUTH_URL` | e.g. `https://auth.europe-west1.gcp.commercetools.com` |
| `CTP_API_URL` | e.g. `https://api.europe-west1.gcp.commercetools.com` |
| `CTP_SCOPES` | Storefront scopes (not `manage_project`) |
| `SESSION_SECRET` | Long random string for signing JWT session cookies |

Press Enter to skip any env var — you can set them later in the Netlify UI.

What the script does:
1. Finds your Netlify account
2. Creates a new site under that account
3. Sets all provided environment variables on the site

## Step 2 — Connect the GitHub repo

After the script completes, open the Admin URL it prints:

1. **Site settings → Build & deploy → Continuous deployment**
2. Click **Link to Git**
3. Select the GitHub repo
4. Netlify will pick up `netlify.toml` automatically

The first deploy starts automatically once the repo is linked.

## Step 3 — Verify the deploy

1. Watch the deploy log in the Netlify UI
2. Once live, verify:
   - Home page loads and shows the hero
   - Login works
   - Country/language selector works
   - Category page loads with products (channel-scoped pricing visible)
   - Dashboard is accessible after login + BU selection
   - Adding a product to cart works
   - Checkout flow completes successfully

## Environment Variables Reference

| Variable | Source | Description |
|---|---|---|
| `CTP_PROJECT_KEY` | CT Merchant Center | Project key |
| `CTP_CLIENT_ID` | CT Merchant Center | Frontend B2B API client ID |
| `CTP_CLIENT_SECRET` | CT Merchant Center | Frontend B2B API client secret |
| `CTP_AUTH_URL` | CT region | Auth server URL |
| `CTP_API_URL` | CT region | API server URL |
| `CTP_SCOPES` | CT Merchant Center | Limited scopes — no `manage_project` |
| `SESSION_SECRET` | Generated locally | `openssl rand -base64 48` |

**CRITICAL:** `CTP_CLIENT_SECRET` and `SESSION_SECRET` are server-only secrets. They must never be prefixed `NEXT_PUBLIC_`. Keep them out of git.

## Notes

- `netlify.toml` has the correct build config — do not modify it
- Node version is pinned to 22 via `NODE_VERSION = "22"` in `netlify.toml`
- To update env vars on an existing site: use the Netlify UI (Site settings → Environment variables)
- `tools/.env` admin credentials are for local scripts only — **never put them on Netlify**

## Checklist

- [ ] Netlify personal access token ready
- [ ] Storefront CT API credentials ready (limited-scope client, not admin)
- [ ] `SESSION_SECRET` generated: `openssl rand -base64 48`
- [ ] `node tools/netlify-setup.mjs` run — site created
- [ ] GitHub repo linked in Netlify UI
- [ ] First deploy succeeded
- [ ] Smoke test: home, login, category (with channel prices), dashboard, cart, checkout
