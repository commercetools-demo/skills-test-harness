# Setup Guide — skills-test-harness

This guide covers the one-time external setup required before the CI harness can run end-to-end. All steps are manual and must be completed before triggering any workflow.

---

## Part 1 — Setup on the plugin repo

### 1.1 Install the GitHub App on the plugin repo

If the App was installed org-wide in Part 0, this is already done. Confirm the App has access to `commercetools-demo/commercetools-plugin`.

### 1.2 Add secrets to the plugin repo

In `commercetools-demo/commercetools-plugin` → Settings → Secrets → Actions, add:

| Secret | Value |
|---|---|
| `HARNESS_APP_ID` | Same value as on the harness repo |
| `HARNESS_APP_PRIVATE_KEY` | Same value as on the harness repo |

### 1.3 Copy the dispatch workflow

Copy `docs/plugin-repo/dispatch-harness.yml` from the harness repo into the plugin repo at `.github/workflows/dispatch-harness.yml`. Commit and push to a test branch.

### 1.4 Verify end-to-end

1. In the skills repo Actions tab, manually trigger "Dispatch to test harness" with `skill: b2c`.
2. Check the harness repo Actions tab — you should see a `b2c-validate` run appear within seconds.
3. Verify a check run appears on the skills commit (it will show "in progress" and then complete with the harness result).

---

## Part 2 — Setup on the harness repo

This guide covers the one-time external setup (Phase 0) required before the CI harness can run end-to-end. All steps are manual and must be completed before triggering any workflow.

---

## Prerequisites

- Admin access to the `commercetools-demo` GitHub organization
- Admin access to the `cofe-pre-sales` Netlify team
- Admin access to a commercetools Merchant Center project (or two projects — one for B2C, one for B2B)
- Claude CLI installed locally (`npm install -g @anthropic-ai/claude-cli` or equivalent)

---

## Step 0.1 — Create the GitHub App (`skills-harness-bot`)

The harness uses a GitHub App (not a PAT) for cross-repo operations so that permissions are scoped to specific repositories and can be revoked cleanly.

1. Go to `https://github.com/organizations/commercetools-demo/settings/apps/new`
2. Fill in:
   - **GitHub App name:** `skills-harness-bot`
   - **Homepage URL:** `https://github.com/commercetools-demo/commercetools-plugin-test-harness`
   - **Webhook:** Uncheck "Active" (the harness does not receive webhooks)
3. Set **Repository permissions:**
   - `Administration`: Read & write (needed to create branches on `skills-scaffold`)
   - `Contents`: Read & write (needed to push generated code and clone skills repo)
   - `Checks`: Read & write (needed to post check runs on skills commits)
   - `Metadata`: Read (required by the dispatch and check-run APIs)
4. Set **Organization permissions:**
   - `Members`: Read (optional — only needed if you want to verify associate membership)
5. Click **Create GitHub App**
6. On the app settings page:
   - Note the **App ID** (a 6-7 digit number) — this becomes `HARNESS_APP_ID`
   - Scroll to **Private keys** → **Generate a private key**
   - Download the `.pem` file — the full contents become `HARNESS_APP_PRIVATE_KEY`
7. Click **Install App** → select `commercetools-demo` → choose **All repositories** (or select `skills-test-harness` and `skills-scaffold` specifically)

---

## Step 0.2 — Pre-create the `skills-scaffold` Repo

The harness pushes generated code to this repo. It must exist before the first publish workflow runs.

1. Go to `https://github.com/organizations/commercetools-demo/repositories/new`
2. Fill in:
   - **Repository name:** `skills-scaffold`
   - **Visibility:** Private
   - **Initialize with a README:** Yes
3. Edit the README to say: _"Canonical scaffolded storefronts. Branches: `b2c/main`, `b2b/main`. Auto-updated by skills-test-harness. Do not edit manually."_
4. Click **Create repository**

The harness will create `b2c/main` and `b2b/main` branches automatically on first publish. No manual branch creation is needed.

---

## Step 0.3 — Generate Claude OAuth Token

The same token is used for both the scaffold step and the judge step.

1. Ensure you have the Claude CLI installed and are logged in:
   ```bash
   claude --version
   ```
2. Generate an OAuth token:
   ```bash
   claude setup-token
   ```
3. Follow the browser-based OAuth flow.
4. Copy the token (it begins with `sk-ant-oat`).
5. This becomes the `CLAUDE_CODE_OAUTH_TOKEN` secret.

> The token has an expiry. If workflows start failing with auth errors, regenerate it and update the secret.

---

## Step 0.4 — Netlify Setup

The harness deploys previews to Netlify for E2E testing.

1. Log in to `https://app.netlify.com` with an account that has access to the `cofe-pre-sales` team.
2. Generate a Personal Access Token:
   - Go to **User settings** (top-right avatar → User settings)
   - Select **Applications** → **Personal access tokens**
   - Click **New access token**
   - Name: `skills-harness-bot`
   - Copy the token — this becomes `NETLIFY_AUTH_TOKEN`
3. Confirm the team slug:
   - Go to the `cofe-pre-sales` team dashboard
   - The URL will be `https://app.netlify.com/teams/cofe-pre-sales/...`
   - The slug is `cofe-pre-sales` (already hardcoded in `scripts/setup-netlify-site.mjs`)

The harness will create two Netlify sites automatically on first deploy:
- `harness-b2c-pr` — used for B2C PR preview deployments
- `harness-b2b-pr` — used for B2B PR preview deployments

---

## Step 0.5 — CT Credentials — Two API Clients

Create two storefront API clients in Merchant Center (or use existing clients if the projects are already set up).

### B2C Client

1. Log in to Merchant Center → select your B2C project
2. Go to **Settings** → **Developer settings** → **API clients**
3. Click **Create new API client**
   - **Name:** `skills-harness-b2c-frontend`
   - **Scopes:** Use the scopes listed in `skill/commercetools-b2c-storefront/ct-client.md` (or equivalent). At minimum:
     - `manage_my_orders`, `manage_my_shopping_lists`, `manage_my_profile`, `manage_my_payments`
     - `view_products`, `view_categories`, `view_published_products`
     - `manage_my_quotes`, `create_anonymous_token`, `view_stores`
4. Copy the values — you'll need them when configuring the `b2c` GitHub Environment in Step 0.6.

### B2B Client

1. Log in to Merchant Center → select your B2B project (may be the same project with different scopes)
2. Repeat the API client creation with B2B scopes from `skills/commercetools-b2b-storefront/references/customer-auth.md`:
   - Additional scopes: `manage_quote_requests`, `manage_orders`, `view_associate_roles`, `view_business_units`, `manage_my_business_units`
3. Copy the values — you'll need them for the `b2b` GitHub Environment in Step 0.6.

### Shared Auth and API URLs

These are the same for all CT projects in a given region:

- `CTP_AUTH_URL`: `https://auth.europe-west1.gcp.commercetools.com` (EU) or `https://auth.us-central1.gcp.commercetools.com` (US)
- `CTP_API_URL`: `https://api.europe-west1.gcp.commercetools.com` (EU) or `https://api.us-central1.gcp.commercetools.com` (US)

### Session Secrets

Generate two random secrets (one per skill):

```bash
openssl rand -base64 48
```

Run this twice. One output is for the `b2c` environment, the other for `b2b`.

---

## Step 0.6 — Configure Secrets, Variables, and Environments on `skills-test-harness`

The harness uses **GitHub Environments** (`b2c` and `b2b`) so that each job gets the right CT credentials without any per-skill conditional logic in the workflow. The setup has three layers.

### Repository-level secrets

Go to `https://github.com/commercetools-demo/commercetools-plugin-test-harness/settings/secrets/actions`:

| Secret | Value | Purpose |
|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | `sk-ant-oat...` from Step 0.3 | Scaffold and judge Claude Code actions |
| `HARNESS_APP_PRIVATE_KEY` | Full `.pem` file contents from Step 0.1 | Signs JWT to mint GitHub App tokens |
| `NETLIFY_AUTH_TOKEN` | PAT from Step 0.4 | Netlify API for deploy |

### Repository-level variables

Go to `https://github.com/commercetools-demo/commercetools-plugin-test-harness/settings/variables/actions`:

| Variable | Value | Purpose |
|---|---|---|
| `HARNESS_APP_ID` | Numeric App ID from Step 0.1 | Identifies the GitHub App |
| `CTP_AUTH_URL` | e.g. `https://auth.europe-west1.gcp.commercetools.com` | Shared CT auth URL |
| `CTP_API_URL` | e.g. `https://api.europe-west1.gcp.commercetools.com` | Shared CT API URL |

### Environments

Go to `https://github.com/commercetools-demo/commercetools-plugin-test-harness/settings/environments` and create two environments: **`b2c`** and **`b2b`**.

For each environment, set these **secrets** and **variables** with the corresponding skill's values:

**Secrets per environment** (`Settings → Environments → <env> → Environment secrets`):

| Secret | Value |
|---|---|
| `CTP_CLIENT_SECRET` | API client secret for this skill's CT project |
| `SESSION_SECRET` | Random 48-byte base64 (`openssl rand -base64 48`) |

**Variables per environment** (`Settings → Environments → <env> → Environment variables`):

| Variable | Value |
|---|---|
| `CTP_PROJECT_KEY` | CT project key for this skill |
| `CTP_CLIENT_ID` | CT API client ID for this skill |
| `CTP_SCOPES` | CT API scopes for this skill (space-separated) |

---

## Setup Checklist

Work through this list top-to-bottom before triggering any workflow.

- [ ] GitHub App `skills-harness-bot` created on `commercetools-demo`
- [ ] GitHub App has `Contents: R/W`, `Checks: R/W`, `Metadata: R`, `Administration: R/W` permissions
- [ ] GitHub App installed on `skills`, `skills-test-harness`, and `skills-scaffold`
- [ ] App ID noted → added as repo variable `HARNESS_APP_ID`
- [ ] Private key `.pem` downloaded → added as repo secret `HARNESS_APP_PRIVATE_KEY`
- [ ] `commercetools-demo/commercetools-plugin-scaffold` repo created (private, with README)
- [ ] Claude OAuth token generated → added as repo secret `CLAUDE_CODE_OAUTH_TOKEN`
- [ ] Netlify PAT generated → added as repo secret `NETLIFY_AUTH_TOKEN`
- [ ] `CTP_AUTH_URL` and `CTP_API_URL` added as repo variables
- [ ] B2C CT API client created → `CTP_CLIENT_SECRET` + `SESSION_SECRET` in `b2c` env secrets; `CTP_PROJECT_KEY` + `CTP_CLIENT_ID` + `CTP_SCOPES` in `b2c` env variables
- [ ] B2B CT API client created → same pattern in `b2b` environment
- [ ] `dispatch-harness.yml` copied to `commercetools-demo/commercetools-plugin` at `.github/workflows/`, `HARNESS_APP_ID` + `HARNESS_APP_PRIVATE_KEY` secrets added there
- [ ] Manually trigger `b2c-validate` via `workflow_dispatch` from harness → verify run completes
- [ ] Confirm `static-check-results.txt` and `judge-result.json` appear as workflow artifacts
- [ ] Manually trigger `b2b-validate` to validate B2B pipeline
- [ ] Push to a branch in `skills` repo with b2c path change → verify dispatch fires and check run appears on commit
- [ ] Merge a change to `skills/main` → verify `skills-scaffold` `b2c/main` branch is updated
