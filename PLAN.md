# Skills Test Harness — Implementation Plan

A CI harness for testing and iterating on the `commercetools-b2c-storefront` and `commercetools-b2b-storefront` Claude skills, hosted at `commercetools-demo/skills-test-harness`.

## Architecture decisions (locked in)

| Decision | Choice |
|---|---|
| Skill source | Copied into `skill/` in this repo |
| Skills covered | b2c and b2b (both, independently) |
| PR-flow generated code | Ephemeral — scaffolded, graded, discarded |
| Publish-flow generated code | Pushed to `commercetools-demo/skills-scaffold`, one branch per skill (`b2c/main`, `b2b/main`) |
| GitHub auth for cross-repo writes | GitHub App installed on `commercetools-demo` |
| Claude auth (scaffold + judge) | OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) for both |
| Netlify team | `cofe-pre-sales` |
| PR-flow triggers | `push` on non-main branches + `workflow_dispatch` (per-skill paths) |
| Publish-flow triggers | `push` to `main` with skill paths changed + `workflow_dispatch` |
| Harness repo visibility | Private |
| PR-flow concurrency | Cancel-in-flight (latest commit wins) |
| Publish-flow concurrency | Queue (don't cancel mid-publish) |

## High-level model

```
                      ┌──────────────────────────────────┐
                      │  skills-test-harness (private)   │
                      │                                  │
                      │  skill/commercetools-b2c-* ──┐   │
                      │  skill/commercetools-b2b-* ──┤   │
                      │                              ▼   │
                      │   tests, prompts, workflows      │
                      └──────────────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
       Push to branch              Merge to main         Push to branch
       (skill/b2c/* path)        (skill/b2c/* path)      (skill/b2b/* path)
              │                        │                        │
              ▼                        ▼                        ▼
       PR-style validation     Generate canonical code   PR-style validation
       (scaffold + test in     and push to a new branch  (scaffold + test in
       ephemeral workspace,    of skills-scaffold  ephemeral workspace,
       no committed output)    repo                      no committed output)
```

## Repo structure

```
skills-test-harness/
├── README.md
├── .gitignore
├── skill/
│   ├── commercetools-b2c-storefront/    # b2c skill (copied)
│   └── commercetools-b2b-storefront/    # b2b skill (copied)
├── prompts/
│   ├── scaffold-b2c.md
│   ├── scaffold-b2b.md
│   ├── judge-b2c.md
│   └── judge-b2b.md
├── .github/workflows/
│   ├── _scaffold-and-test.yml           # reusable workflow (workflow_call)
│   ├── b2c-pr.yml                       # push to branch, skill/b2c/* paths
│   ├── b2c-publish.yml                  # merge to main, skill/b2c/* paths
│   ├── b2b-pr.yml
│   └── b2b-publish.yml
├── scripts/
│   ├── slugify.mjs
│   ├── push-to-generated-repo.mjs       # pushes scaffold to b2c/main or b2b/main
│   ├── setup-netlify-site.mjs           # PR-flow Netlify (optional deploy)
│   ├── wait-for-netlify-deploy.mjs
│   ├── parse-judge-output.mjs           # reads judge-result.json → action outputs
│   └── post-summary-comment.mjs         # commit/PR comment with results
├── tests/
│   ├── criteria-b2c.md
│   ├── criteria-b2b.md
│   ├── static-checks-b2c.sh
│   ├── static-checks-b2b.sh
│   └── playwright/
│       ├── package.json
│       ├── playwright.config.ts
│       ├── b2c/                         # b2c E2E specs
│       └── b2b/                         # b2b E2E specs
└── docs/
    ├── setup.md
    ├── architecture.md
    └── troubleshooting.md
```

---

## Phase 0 — External setup (one-time, manual)

### 0.1 Create the GitHub App
- Name: `skills-harness-bot` (or similar)
- Owner: `commercetools-demo`
- Permissions:
  - Repository: `Administration: Read & write`, `Contents: Read & write`
  - Organization: `Members: Read` (optional)
- Generate a private key (`.pem`), copy the App ID
- Install on **all repositories** in the org

### 0.2 Pre-create the canonical generated repo
- Create `commercetools-demo/skills-scaffold` — private, empty
- Add a README explaining: "Canonical scaffolded storefronts. Branches: `b2c/main`, `b2b/main`. Auto-updated by skills-test-harness."
- The harness never creates this repo; it just pushes branches into it.

### 0.3 Generate Claude OAuth token
- Locally: `claude setup-token`
- Copy the `sk-ant-oat...` token

### 0.4 Netlify
- Generate a personal access token at app.netlify.com → User settings → Applications
- Confirm `cofe-pre-sales` team slug from team URL

### 0.5 CT credentials — two clients
Create two storefront API clients in CT Merchant Center (or use existing):
- **Frontend B2C** — scopes from b2c skill's `ct-client.md`
- **Frontend B2B** — scopes for b2b storefront

Generate session secrets: `openssl rand -base64 48` (one per skill).

### 0.6 Set secrets on `commercetools-demo/skills-test-harness`

| Secret | Purpose |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Both scaffold and judge steps |
| `HARNESS_APP_ID` | GitHub App ID |
| `HARNESS_APP_PRIVATE_KEY` | GitHub App private key (full `.pem` contents) |
| `NETLIFY_AUTH_TOKEN` | Netlify API |
| `CTP_AUTH_URL` | Shared CT auth URL |
| `CTP_API_URL` | Shared CT API URL |
| `CTP_B2C_PROJECT_KEY` | B2C CT project |
| `CTP_B2C_CLIENT_ID` | B2C storefront client |
| `CTP_B2C_CLIENT_SECRET` | B2C storefront client |
| `CTP_B2C_SCOPES` | B2C scopes |
| `SESSION_SECRET_B2C` | B2C JWT signing |
| `CTP_B2B_PROJECT_KEY` | B2B CT project |
| `CTP_B2B_CLIENT_ID` | B2B storefront client |
| `CTP_B2B_CLIENT_SECRET` | B2B storefront client |
| `CTP_B2B_SCOPES` | B2B scopes |
| `SESSION_SECRET_B2B` | B2B JWT signing |

---

## Phase 1 — Reusable workflow + thin entry points

### `_scaffold-and-test.yml` (callable via `workflow_call`)

**Inputs:**
- `skill_name` — `commercetools-b2c-storefront` or `commercetools-b2b-storefront`
- `skill_slug` — `b2c` or `b2b`
- `publish` — boolean; if true, push output to `skills-scaffold`
- `deploy` — boolean; if true, deploy to Netlify and run Playwright

**Steps (in order):**

1. Checkout harness
2. Mint GitHub App token (`actions/create-github-app-token`)
3. Copy `skill/${skill_name}/` to `.claude/skills/${skill_name}/`
4. Run `anthropics/claude-code-action@v1`:
   - `claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}`
   - `prompt_file: prompts/scaffold-${skill_slug}.md`
   - `claude_args: --max-turns 200`
5. Verify `./output/` exists and contains `package.json` — fail if not
6. Run `tests/static-checks-${skill_slug}.sh ./output/` — capture pass/fail and findings
7. Run `anthropics/claude-code-action@v1` a second time:
   - Same OAuth token
   - `prompt_file: prompts/judge-${skill_slug}.md`
   - Instructs Claude to write `judge-result.json`
8. Run `scripts/parse-judge-output.mjs` — set workflow outputs, fail if `critical_violations` non-empty
9. **If `deploy == true`:**
   - Run `scripts/setup-netlify-site.mjs` — create/reuse `harness-${skill_slug}-pr` Netlify site, set env vars, manual-deploy `./output/`
   - Run `scripts/wait-for-netlify-deploy.mjs` — outputs `preview_url`
   - Run Playwright against preview URL: `cd tests/playwright && npm ci && npx playwright test ${skill_slug}/`
10. **If `publish == true`:**
    - Run `scripts/push-to-generated-repo.mjs` — clones `skills-scaffold`, switches to `${skill_slug}/main` branch (creates if missing), wipes contents, copies `./output/`, commits with harness SHA, force-pushes with lease
11. Upload artifacts: `judge-result.json`, `output/` (gzipped), Playwright report
12. Run `scripts/post-summary-comment.mjs` — commit comment (or PR comment if PR context) with: skill, status, judge score, top violations, preview URL (if deployed), generated repo link (if published)

### `b2c-pr.yml`

```yaml
name: B2C — PR validation
on:
  push:
    branches-ignore: [main]
    paths:
      - 'skill/commercetools-b2c-storefront/**'
      - 'prompts/scaffold-b2c.md'
      - 'prompts/judge-b2c.md'
      - 'tests/criteria-b2c.md'
      - 'tests/static-checks-b2c.sh'
      - 'tests/playwright/b2c/**'
      - '.github/workflows/_scaffold-and-test.yml'
      - '.github/workflows/b2c-pr.yml'
  workflow_dispatch:

concurrency:
  group: b2c-pr-${{ github.ref }}
  cancel-in-progress: true

jobs:
  scaffold-and-test:
    uses: ./.github/workflows/_scaffold-and-test.yml
    with:
      skill_name: commercetools-b2c-storefront
      skill_slug: b2c
      publish: false
      deploy: true
    secrets: inherit
```

### `b2c-publish.yml`

```yaml
name: B2C — Publish to skills-scaffold
on:
  push:
    branches: [main]
    paths:
      - 'skill/commercetools-b2c-storefront/**'
      - 'prompts/scaffold-b2c.md'
  workflow_dispatch:

concurrency:
  group: b2c-publish
  cancel-in-progress: false   # don't cancel a publish mid-flight; queue

jobs:
  scaffold-and-publish:
    uses: ./.github/workflows/_scaffold-and-test.yml
    with:
      skill_name: commercetools-b2c-storefront
      skill_slug: b2c
      publish: true
      deploy: false           # publish flow's deliverable is the canonical code
    secrets: inherit
```

### `b2b-pr.yml` and `b2b-publish.yml`
Mirror the b2c versions with `skill_name: commercetools-b2b-storefront` and `skill_slug: b2b`.

---

## Phase 2 — Prompts

### `prompts/scaffold-b2c.md`
- Points at `.claude/skills/commercetools-b2c-storefront/`
- Output directory: `./output/`
- Scope: "Core — Green-Field Build" section of SKILL.md, in order
- Skip all "Optional Features" (superuser, BOPIS, bundles, promotions)
- Required deliverables: `npm run build` passes, `tsc --noEmit` passes, `netlify.toml` at output root, `.env.example`, generated `README.md`
- Anti-patterns to honour (cite SKILL.md table)
- Output format when done: structured summary block

### `prompts/scaffold-b2b.md`
- Points at `.claude/skills/commercetools-b2b-storefront/`
- Same structure; emphasizes B2B concepts: business units, associates, store-scoped pricing, permissions, quotes, approval flows
- Skip optional features: superuser, wishlists

### `prompts/judge-b2c.md` and `judge-b2b.md`
Instructs the second Claude Code action to:
1. Read `./output/` file structure and key files
2. Read `tests/criteria-${slug}.md`
3. Read `static-check-results.txt` (written by step 6)
4. Read Playwright JUnit XML if present (`tests/playwright/results.xml`)
5. Write strictly-formatted JSON to `judge-result.json`:
   ```json
   {
     "score": 0,
     "critical_violations": [{"item": "...", "evidence": "..."}],
     "high_violations": [...],
     "medium_violations": [...],
     "passed_checks": [...],
     "notes": "..."
   }
   ```
6. Be explicit: "Write ONLY judge-result.json. Do not edit any other files. Do not run any commands beyond reading files."

---

## Phase 3 — Scripts

### `slugify.mjs`
- Input: branch name (e.g. `feat/cart-fix`, `experiment-#42`)
- Lowercase, replace non-alphanumeric with `-`, collapse multiples, trim, cap at 30 chars
- Exports a function and acts as a CLI

### `push-to-generated-repo.mjs`
- Uses `@octokit/rest` with GitHub App token
- Clones `commercetools-demo/skills-scaffold` into temp dir
- Switches to `${skill_slug}/main` branch (creates orphan branch if absent)
- Wipes everything except `.git/`
- Copies `./output/*` into the worktree
- Commits with message: `Update ${skill_slug} scaffold from harness ${harness_sha}`
- Pushes with `--force-with-lease`

### `setup-netlify-site.mjs`
- Idempotent: looks up `harness-${skill_slug}-pr` site under `cofe-pre-sales`
- Creates if absent
- Sets all env vars on the site (CT creds + `SESSION_SECRET_${slug}`)
- Triggers a manual deploy from `./output/` (no git link — direct upload via Netlify API)

### `wait-for-netlify-deploy.mjs`
- Polls `GET /sites/{site_id}/deploys?per_page=1` every 15s
- Waits for `state: ready` or `state: error`
- Timeout: 10 minutes
- Writes `preview_url=<ssl_url>` to `$GITHUB_OUTPUT`

### `parse-judge-output.mjs`
- Reads `judge-result.json`
- Sets `$GITHUB_OUTPUT`: `score`, `critical_count`, `high_count`, `medium_count`
- Exits 1 if `critical_violations.length > 0`

### `post-summary-comment.mjs`
- Uses GitHub App token
- Detects context: PR (`GITHUB_EVENT_NAME == 'pull_request'`) vs push (`GITHUB_EVENT_NAME == 'push'`)
- Posts a PR comment or commit comment with:
  - Skill name + status emoji
  - Judge score and breakdown
  - Top 3 critical/high violations with evidence
  - Preview URL (if deployed)
  - Generated repo link (if published)
  - Link to workflow run for full details

---

## Phase 4 — Netlify strategy for PR flows

**Option A (chosen):** One persistent Netlify site per skill (`harness-b2c-pr`, `harness-b2b-pr`). Each PR flow does a manual deploy of `./output/` directly via the Netlify API. Latest push overwrites the previous deploy.

**Why:** Canonical code lives in `skills-scaffold` and can be wired to its own permanent Netlify deploys independently. PR previews are throwaway; manual deploys keep permissions simple.

**Trade-off:** No per-branch URLs — concurrent PRs would race for the preview site. Cancel-in-flight concurrency on the PR workflow mitigates this; only the latest push's deploy survives.

---

## Phase 5 — Tests

### `tests/criteria-b2c.md`
Mirrors b2c skill's SKILL.md priority tiers:
- **Critical** — BFF architecture, cart versioning, session secrets, CT login endpoint, cart creation `shippingMode`
- **High** — parallel fetching, type safety, anonymous cart merge, SWR cache invalidation, CT type boundary
- **Medium** — Product Search API v2, `unstable_cache`, cart state cleared after order, locale format duality
- **Smoke** — homepage loads, category loads with products, PDP loads with variant selector, add to cart works, checkout reaches confirmation

### `tests/criteria-b2b.md`
Mirrors b2b skill's SKILL.md priority tiers:
- **Critical** — as-associate chain, session B2B fields, locale four-field atomicity, session for product pricing, CT login endpoint, lib/ct is server-only
- **High** — BU key in SWR cache keys, permission gating, parallel fetching, mappers, CartContext auto-creation
- **Medium** — no-fetch-in-client, store data cache, product type cache, approval flow graceful degradation, Quote.sellerComment per round
- **Smoke** — login → BU selection works, channel-scoped pricing visible on PLP/PDP, cart creation includes BU + store, quote list page loads, approval rules list loads (or graceful empty)

### `tests/static-checks-b2c.sh`
Bash script. Greps `./output/` for b2c anti-patterns:
- `NEXT_PUBLIC_CTP` — must not appear in any file
- `from '@/lib/ct` in any file containing `'use client'`
- `from 'next/link'` or `from 'next/navigation'` (should be `@/i18n/routing`)
- `apiRoot.customers().login()` (should be `apiRoot.login().post()`)
- `import { apiRoot }` in any `'use client'` file
- `NEXT_PUBLIC_CTP_CLIENT_SECRET` specifically — fail hard
- Outputs findings to `static-check-results.txt`
- Exits 1 on any violation

### `tests/static-checks-b2b.sh`
B2B-specific:
- `apiRoot.carts()` in `output/lib/ct/` outside of `asAssociate` chain
- `apiRoot.shoppingLists()` in purchase-list code (should be `asAssociate().*.shoppingLists()`)
- Permission-check logic inside Route Handlers (anti-pattern: should be CT-enforced)
- `StagedQuote.sellerComment` used in per-round quote display
- All b2c shared anti-patterns also apply (`NEXT_PUBLIC_CTP`, `lib/ct` in client files, etc.)

### Playwright

`tests/playwright/playwright.config.ts` — uses `BASE_URL` env var, chromium only in CI, all browsers locally.

**b2c specs** (`tests/playwright/b2c/`):
- `homepage.spec.ts` — loads, shows products, meta tags present
- `category.spec.ts` — known category slug loads, paginates
- `pdp.spec.ts` — known SKU URL loads, variant click changes URL
- `cart.spec.ts` — add to cart from PDP, mini-cart shows item
- `checkout.spec.ts` — anonymous → addresses step renders form (no real payment)

**b2b specs** (`tests/playwright/b2b/`):
- `auth.spec.ts` — login with test associate, BU auto-selection works
- `pricing.spec.ts` — PLP shows channel-scoped prices (not "Price on request")
- `pdp.spec.ts` — known SKU, price visible, variant selector works
- `cart.spec.ts` — add to cart, line item includes distributionChannel
- `quotes.spec.ts` — quotes list page loads (or shows empty state without error)

---

## Phase 6 — Documentation

### `docs/setup.md`
Walks through Phase 0 step by step. Precise instructions, click paths, secret names. Includes a checklist at the end.

### `docs/architecture.md`
Why these decisions. Sections:
- Why PR flow is ephemeral (not per-branch repos)
- Why publish flow uses one repo with per-skill branches
- Why OAuth token for both scaffold and judge
- Why concurrency rules differ between PR and publish
- Why one repo for both skills

### `docs/troubleshooting.md`
Common failures and fixes:
- "Scaffold ran out of turns" → bump `--max-turns` in `_scaffold-and-test.yml`
- "Static check failed" → reproduce locally with `bash tests/static-checks-b2c.sh ./output/`
- "Netlify deploy timed out" → check function logs, env vars on the site
- "Publish workflow ran but skills-scaffold not updated" → check GitHub App `Contents: write` permission, check it's installed on `skills-scaffold`
- "Judge JSON malformed" → check `prompts/judge-*.md` is strict enough about output format

---

## Open questions (decide as you go)

1. **Auto-deploy `skills-scaffold`?** Independent of the harness. Once the repo exists, you can link its branches to Netlify with branch deploys: `b2c/main` → `b2c-canonical.netlify.app`, `b2b/main` → `b2b-canonical.netlify.app`. The harness doesn't manage this.

2. **Static-check failures: block or warn?** Plan blocks on critical anti-patterns. Lower-tier violations only appear in the judge output. Adjustable in `static-checks-${slug}.sh` exit codes.

3. **Smoke test the publish flow's canonical deployment?** Plan skips Netlify+Playwright on publish (deliverable is the code). Easy to add later by flipping `deploy: true` in `b2c-publish.yml`.

4. **PR comments vs commit comments?** Plan auto-detects context. Most pushes won't have a PR open; commit comments are the fallback.

---

## Recommended build order

1. Phase 1 skeleton + Phase 6 docs draft → repo is navigable
2. Phase 0 external setup → secrets and `skills-scaffold` exist
3. b2c PR flow: reusable workflow + `b2c-pr.yml` + `scaffold-b2c.md` + `criteria-b2c.md` + `static-checks-b2c.sh` → b2c PR flow works end-to-end with manual trigger
4. b2c publish flow: `b2c-publish.yml` + `push-to-generated-repo.mjs` → merge to main updates `skills-scaffold`
5. b2c judge: `judge-b2c.md` + `parse-judge-output.mjs` → grading works
6. b2c Netlify + Playwright → full b2c pipeline
7. Duplicate for b2b: prompts, criteria, static checks, Playwright suite, entry workflows
8. Polish docs and troubleshooting

Each step independently testable. Stop and validate before moving on.

---

## What's out of scope for v1

- Auto-cleanup of stale Netlify deploys
- Matrix builds across skill variants in parallel
- Cost tracking per run
- Comparing two branches side-by-side (diffing generated outputs)
- Auto-create a harness branch when a skill PR is opened upstream

All reasonable v2 items once v1 is proven.
