# Netlify Deployment

**Impact: MEDIUM — Using admin (`tools/.env`) credentials instead of the storefront API client exposes full project management access to the public site.**

The storefront needs a **Frontend B2C** CT API client with limited scope. The admin client from `tools/.env` must never be used on a public host.

## Table of Contents
- [Pattern 1: Credentials Rule](#pattern-1-credentials-rule)
- [Pattern 2: Setup Script](#pattern-2-setup-script)
- [Pattern 3: Connect Repo](#pattern-3-connect-repo)

---

## Pattern 1: Credentials Rule

**INCORRECT:** copying `tools/.env` credentials to Netlify environment variables.

```
# BAD — this is the admin client, scope: manage_project
CTP_CLIENT_ID=admin-client-id
CTP_CLIENT_SECRET=admin-secret   ← full project access, public-facing!
CTP_SCOPE=manage_project:my-project
```

**CORRECT — only `site/.env` values (Frontend B2C client, limited scope):**

```bash
# GOOD — storefront client (Frontend B2C)
# Scope: view_products, manage_my_orders, manage_my_payments,
#        manage_my_shopping_lists, view_categories, etc.
CTP_CLIENT_ID=storefront-client-id
CTP_CLIENT_SECRET=storefront-secret
CTP_PROJECT_KEY=my-project
CTP_API_URL=https://api.europe-west1.gcp.commercetools.com
CTP_AUTH_URL=https://auth.europe-west1.gcp.commercetools.com
CTP_SCOPE=view_products:my-project manage_my_orders:my-project ...
SESSION_SECRET=<random 48-byte base64 string>
```

If `site/.env` is missing, create a **new** Frontend B2C API client in Merchant Center (Settings → Developer settings → API clients → Create new). Do **not** use the tools client.

---

## Pattern 2: Setup Script

Run the automated provisioning script — it prompts for inputs and handles everything:

```bash
node tools/netlify-setup.mjs
```

The script will ask for:
1. **Netlify personal access token** — generate at https://app.netlify.com/user/applications#personal-access-tokens
2. **Site name** — must be unique on Netlify (e.g. `acme-b2c-storefront`)
3. **CT credentials** — paste from `site/.env` (the storefront API client, NOT tools)

What the script does:
- Creates a new Netlify site
- Sets all environment variables from `site/.env` plus any extras you provide
- Outputs the site URL and dashboard link

```bash
# If you need to generate SESSION_SECRET manually:
openssl rand -base64 48
```

---

## Pattern 3: Connect Repo

After the script completes, link the Git repository so Netlify builds on push:

1. Go to the new site in the Netlify dashboard
2. **Site settings → Build & deploy → Link repository**
3. Authorise GitHub / GitLab, select the repo
4. Netlify reads `netlify.toml` at the repo root — it already contains:

```toml
# netlify.toml  (already in repo root — do not modify)
[build]
  base    = "site/"
  command = "npm run build"
  publish = "site/.next"

[build.environment]
  NODE_VERSION = "20"
```

5. Trigger the first deploy: **Deploys → Trigger deploy → Deploy site**
6. Verify the site loads and CT API calls succeed (check the Function logs if products don't appear)

---

## Checklist
- [ ] Netlify personal access token generated and ready
- [ ] Storefront CT API client credentials from `site/.env` (Frontend B2C, NOT `tools/.env`)
- [ ] `SESSION_SECRET` generated: `openssl rand -base64 48`
- [ ] `node tools/netlify-setup.mjs` run successfully
- [ ] Repository linked in Netlify dashboard (Build & deploy → Link repository)
- [ ] First deploy triggered and verified — homepage loads, products visible
- [ ] CT Merchant Center: storefront API client scopes confirmed (no `manage_project`)
