# Plan Addendum — Two-Repo Architecture

This addendum modifies the original `PLAN.md` to source skills from `commercetools-demo/skills` instead of from inside the harness repo. The harness becomes a pure testing tool; skills are edited and reviewed in their own repo.

Apply these changes on top of the original plan. Anything not mentioned here stays the same.

---

## New trigger model

```
commercetools-demo/skills                    commercetools-demo/skills-test-harness
─────────────────────────────                ─────────────────────────────────────
push to non-main branch                      
  with skills/<skill>/* changes              
                │                            
                ▼                            
  .github/workflows/dispatch-harness.yml     
                │                            
                │  repository_dispatch       
                │  event: b2c-validate       
                │  payload: { ref, sha }     
                └──────────────────────────► 
                                              .github/workflows/b2c-validate.yml
                                                            │
                                                            ▼
                                              _scaffold-and-test.yml (reusable)
                                                  │
                                                  │  git clone --branch <ref>
                                                  │  commercetools-demo/skills
                                                  ▼
                                              scaffold → test → judge → check run
                                                            │
                                              ┌─────────────┘
                                              │
                                              │  GitHub check run created on
                                              ▼  commercetools-demo/skills@<sha>
                                            (visible in the originating commit)
```

## Section 1 — Architecture decisions, updated table

Replace the architecture-decisions table in `PLAN.md` with this version:

| Decision | Choice |
|---|---|
| Skills source | Pulled at run time from `commercetools-demo/skills` (specific branch + SHA) |
| Skills covered | b2c and b2b (both, independently) |
| Trigger mechanism | `repository_dispatch` from `skills` repo to harness; `workflow_dispatch` for manual runs |
| PR-flow generated code | Ephemeral — scaffolded, graded, discarded |
| Publish-flow generated code | Pushed to `commercetools-demo/generated-storefronts`, branches `b2c/main`, `b2b/main` |
| GitHub auth for cross-repo work | One GitHub App installed on both `skills` and `skills-test-harness` and `generated-storefronts` |
| Claude auth (scaffold + judge) | OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`) for both |
| Netlify team | `cofe-pre-sales` |
| Results reporting | GitHub **check run** on the `skills` repo commit (not a comment on the harness) |
| PR-flow concurrency | Cancel-in-flight, keyed by `skills_repo_ref` |
| Publish-flow concurrency | Queue (don't cancel mid-publish) |

---

## Section 2 — Repo structure, updated

Remove `skill/` directory entirely from the harness repo plan. The structure becomes:

```
skills-test-harness/
├── README.md
├── .gitignore
├── prompts/
│   ├── scaffold-b2c.md
│   ├── scaffold-b2b.md
│   ├── judge-b2c.md
│   └── judge-b2b.md
├── .github/workflows/
│   ├── _scaffold-and-test.yml      ← reusable, takes skills_repo_ref input
│   ├── b2c-validate.yml            ← repository_dispatch: b2c-validate
│   ├── b2c-publish.yml             ← repository_dispatch: b2c-publish
│   ├── b2b-validate.yml
│   └── b2b-publish.yml
├── scripts/
│   ├── slugify.mjs
│   ├── checkout-skill.mjs          ← NEW: clones skills repo at ref into workspace
│   ├── push-to-generated-repo.mjs
│   ├── setup-netlify-site.mjs
│   ├── wait-for-netlify-deploy.mjs
│   ├── parse-judge-output.mjs
│   ├── create-check-run.mjs        ← NEW: replaces post-summary-comment.mjs
│   └── update-check-run.mjs        ← NEW: posts final result to the in-progress check
├── tests/...                        (unchanged)
└── docs/
    ├── setup.md                     (updated content — see Section 6)
    ├── architecture.md
    ├── troubleshooting.md
    └── two-repo-flow.md             ← NEW
```

---

## Section 3 — Phase 0 changes (external setup)

### 3.1 Update the GitHub App

The app from the original plan now needs broader scope. Update its installation and permissions:

- Installed on **all repositories** in `commercetools-demo` (was already; reconfirm)
- Permissions:
  - Repository: `Administration: Read & write`, `Contents: Read & write` (unchanged)
  - Repository: **`Checks: Read & write`** (NEW — for posting check runs on `skills` commits)
  - Repository: **`Metadata: Read`** (NEW — required by the dispatch API)
- The app must have access to all three repos: `skills`, `skills-test-harness`, `generated-storefronts`

### 3.2 Add secrets on the `skills` repo (NEW)

The `skills` repo needs to be able to dispatch to the harness. Add these secrets to `commercetools-demo/skills`:

| Secret | Purpose |
|---|---|
| `HARNESS_APP_ID` | Same App ID as harness |
| `HARNESS_APP_PRIVATE_KEY` | Same private key |

Same values as on the harness repo. Using the same App means one credential pair, two installations.

### 3.3 Harness secrets — unchanged

All secrets listed in the original PLAN.md Section 0.6 stay the same. The harness still needs `CTP_B2C_*`, `CTP_B2B_*`, Netlify, Claude OAuth, App credentials.

---

## Section 4 — New file in the `skills` repo

Create this file in `commercetools-demo/skills`:

### `.github/workflows/dispatch-harness.yml`

```yaml
name: Dispatch to test harness

on:
  push:
    paths:
      - 'skills/commercetools-b2c-storefront/**'
      - 'skills/commercetools-b2b-storefront/**'
      - '.github/workflows/dispatch-harness.yml'
  workflow_dispatch:
    inputs:
      skill:
        description: 'Which skill to dispatch'
        required: true
        type: choice
        options: [b2c, b2b, both]

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Detect changed skills
        id: changes
        if: github.event_name == 'push'
        uses: dorny/paths-filter@v3
        with:
          filters: |
            b2c:
              - 'skills/commercetools-b2c-storefront/**'
            b2b:
              - 'skills/commercetools-b2b-storefront/**'

      - name: Determine event suffix
        id: suffix
        run: |
          if [ "${{ github.ref }}" = "refs/heads/main" ]; then
            echo "value=publish" >> "$GITHUB_OUTPUT"
          else
            echo "value=validate" >> "$GITHUB_OUTPUT"
          fi

      - name: Mint App token for harness dispatch
        id: app-token
        uses: actions/create-github-app-token@v1
        with:
          app-id: ${{ secrets.HARNESS_APP_ID }}
          private-key: ${{ secrets.HARNESS_APP_PRIVATE_KEY }}
          owner: commercetools-demo
          repositories: skills-test-harness

      - name: Dispatch b2c
        if: |
          (github.event_name == 'push' && steps.changes.outputs.b2c == 'true') ||
          (github.event_name == 'workflow_dispatch' && (inputs.skill == 'b2c' || inputs.skill == 'both'))
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: |
          gh api repos/commercetools-demo/skills-test-harness/dispatches \
            -f event_type="b2c-${{ steps.suffix.outputs.value }}" \
            -F client_payload[skills_repo_ref]="${{ github.ref_name }}" \
            -F client_payload[skills_repo_sha]="${{ github.sha }}" \
            -F client_payload[trigger_actor]="${{ github.actor }}"

      - name: Dispatch b2b
        if: |
          (github.event_name == 'push' && steps.changes.outputs.b2b == 'true') ||
          (github.event_name == 'workflow_dispatch' && (inputs.skill == 'b2b' || inputs.skill == 'both'))
        env:
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
        run: |
          gh api repos/commercetools-demo/skills-test-harness/dispatches \
            -f event_type="b2b-${{ steps.suffix.outputs.value }}" \
            -F client_payload[skills_repo_ref]="${{ github.ref_name }}" \
            -F client_payload[skills_repo_sha]="${{ github.sha }}" \
            -F client_payload[trigger_actor]="${{ github.actor }}"
```

That's the only file added to the `skills` repo. Everything else lives in the harness.

---

## Section 5 — Harness workflow changes

### 5.1 Replace `b2c-pr.yml` with `b2c-validate.yml`

```yaml
name: B2C — Validate skill from skills repo

on:
  repository_dispatch:
    types: [b2c-validate]
  workflow_dispatch:
    inputs:
      skills_repo_ref:
        description: 'Branch in commercetools-demo/skills to test'
        required: true
        default: 'main'
      skills_repo_sha:
        description: 'Commit SHA (optional)'
        required: false

concurrency:
  group: b2c-validate-${{ github.event.client_payload.skills_repo_ref || inputs.skills_repo_ref }}
  cancel-in-progress: true

jobs:
  scaffold-and-test:
    uses: ./.github/workflows/_scaffold-and-test.yml
    with:
      skill_name: commercetools-b2c-storefront
      skill_slug: b2c
      skills_repo_ref: ${{ github.event.client_payload.skills_repo_ref || inputs.skills_repo_ref }}
      skills_repo_sha: ${{ github.event.client_payload.skills_repo_sha || inputs.skills_repo_sha || '' }}
      publish: false
      deploy: true
    secrets: inherit
```

### 5.2 Replace `b2c-publish.yml`

```yaml
name: B2C — Publish to generated-storefronts

on:
  repository_dispatch:
    types: [b2c-publish]
  workflow_dispatch:
    inputs:
      skills_repo_ref:
        description: 'Branch in commercetools-demo/skills (use main)'
        required: true
        default: 'main'

concurrency:
  group: b2c-publish
  cancel-in-progress: false

jobs:
  scaffold-and-publish:
    uses: ./.github/workflows/_scaffold-and-test.yml
    with:
      skill_name: commercetools-b2c-storefront
      skill_slug: b2c
      skills_repo_ref: ${{ github.event.client_payload.skills_repo_ref || inputs.skills_repo_ref }}
      skills_repo_sha: ${{ github.event.client_payload.skills_repo_sha || '' }}
      publish: true
      deploy: false
    secrets: inherit
```

### 5.3 `b2b-validate.yml` and `b2b-publish.yml`

Mirror the b2c versions with `skill_name: commercetools-b2b-storefront`, `skill_slug: b2b`, and event types `b2b-validate` / `b2b-publish`.

### 5.4 Update the reusable workflow `_scaffold-and-test.yml`

**Add inputs:**

```yaml
on:
  workflow_call:
    inputs:
      skill_name:
        required: true
        type: string
      skill_slug:
        required: true
        type: string
      skills_repo_ref:           # NEW
        required: true
        type: string
      skills_repo_sha:           # NEW
        required: false
        type: string
        default: ''
      publish:
        required: true
        type: boolean
      deploy:
        required: true
        type: boolean
```

**Replace Step 3 of the reusable workflow.** Original step copied from `skill/` in the harness. New step clones the `skills` repo at the given ref:

```yaml
- name: Mint App token (broad)
  id: app-token
  uses: actions/create-github-app-token@v1
  with:
    app-id: ${{ secrets.HARNESS_APP_ID }}
    private-key: ${{ secrets.HARNESS_APP_PRIVATE_KEY }}
    owner: commercetools-demo

- name: Checkout skill from skills repo
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
  run: |
    node scripts/checkout-skill.mjs \
      --skill-name "${{ inputs.skill_name }}" \
      --ref "${{ inputs.skills_repo_ref }}" \
      ${{ inputs.skills_repo_sha && format('--sha {0}', inputs.skills_repo_sha) || '' }}
```

`checkout-skill.mjs` clones `commercetools-demo/skills` at the given branch (and verifies the SHA matches if provided), then copies `skills/<skill_name>/` into `.claude/skills/<skill_name>/`.

**Add a step right after token minting — create the in-progress check run on the skills commit:**

```yaml
- name: Create in-progress check on skills commit
  id: check
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
  run: |
    node scripts/create-check-run.mjs \
      --sha "${{ inputs.skills_repo_sha }}" \
      --name "Harness: ${{ inputs.skill_slug }} ${{ inputs.publish && 'publish' || 'validate' }}" \
      --run-url "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
```

This step writes the check run ID to `$GITHUB_OUTPUT` as `check_run_id`.

**Replace the final summary step.** The original posted a commit comment on the harness. The new version updates the check run on the `skills` commit:

```yaml
- name: Update check run with result
  if: always()
  env:
    GH_TOKEN: ${{ steps.app-token.outputs.token }}
  run: |
    node scripts/update-check-run.mjs \
      --check-run-id "${{ steps.check.outputs.check_run_id }}" \
      --status "${{ job.status }}" \
      --skill-slug "${{ inputs.skill_slug }}" \
      --judge-output judge-result.json \
      --preview-url "${{ env.PREVIEW_URL || '' }}" \
      --published-branch "${{ inputs.publish && format('{0}/main', inputs.skill_slug) || '' }}"
```

**Skip the GitHub App token step inside the publish step** — reuse `steps.app-token.outputs.token` from earlier. The reusable workflow now has one token mint that serves all cross-repo operations.

---

## Section 6 — New scripts

### 6.1 `scripts/checkout-skill.mjs`

Responsibilities:
- Parse `--skill-name`, `--ref`, optional `--sha`
- Use `GH_TOKEN` env var (the App token) for authenticated clone
- `git clone --depth 1 --branch <ref> https://x-access-token:<token>@github.com/commercetools-demo/skills.git /tmp/skills-checkout`
- If `--sha` provided, verify `git rev-parse HEAD` matches; fail loudly if not (means a force-push happened between dispatch and checkout)
- Create `.claude/skills/` in workspace
- Copy `/tmp/skills-checkout/skills/<skill-name>/` to `.claude/skills/<skill-name>/`
- Clean up the temp clone

Failure modes to handle:
- Skill folder doesn't exist at that ref → exit 1 with a clear message
- Auth fails → exit 1, surface that the App might not be installed on `skills`

### 6.2 `scripts/create-check-run.mjs`

Responsibilities:
- Parse `--sha`, `--name`, `--run-url`
- Use Octokit with `GH_TOKEN`
- `octokit.checks.create({ owner: 'commercetools-demo', repo: 'skills', head_sha: sha, name, status: 'in_progress', details_url: run_url, started_at: new Date().toISOString() })`
- Write `check_run_id=<id>` to `$GITHUB_OUTPUT`

If `--sha` is empty (manual `workflow_dispatch` without a SHA), skip creating the check run gracefully and write `check_run_id=` (empty). The update script handles the empty case as a no-op.

### 6.3 `scripts/update-check-run.mjs`

Responsibilities:
- Parse args including `--check-run-id`, `--status` (`success`/`failure`/`cancelled`), `--skill-slug`, `--judge-output` (path to judge-result.json), `--preview-url`, `--published-branch`
- Map workflow `job.status` to GitHub check conclusion: `success` → `success`, `failure` → `failure`, `cancelled` → `cancelled`, anything else → `neutral`
- Read judge JSON if present, build a markdown summary
- Call `octokit.checks.update` with:
  - `status: 'completed'`
  - `conclusion: <mapped>`
  - `completed_at: <ISO timestamp>`
  - `output.title`: short status line
  - `output.summary`: markdown with score, top violations, preview URL, generated repo link
  - `output.text`: optional, longer detail
- If `check_run_id` is empty, exit 0 silently (manual run, no SHA to attach to)

### 6.4 Delete `scripts/post-summary-comment.mjs`

The original plan's comment-posting script is superseded by check runs. Remove it from the plan.

---

## Section 7 — Concurrency keys

Update the concurrency groups in the validate workflows. The original plan keyed on `github.ref` (the harness's branch). With dispatch, the harness doesn't have a meaningful branch — it always runs from `main` of the harness. Key on the **skills repo branch** instead:

```yaml
concurrency:
  group: b2c-validate-${{ github.event.client_payload.skills_repo_ref || inputs.skills_repo_ref }}
  cancel-in-progress: true
```

This means: two pushes to `skills/feat-foo` will cancel the in-flight run for `feat-foo`, but a push to `skills/feat-bar` runs concurrently. Correct behaviour.

Publish flow concurrency stays as a single group (`b2c-publish`, queued) — there's only one canonical output and you never want overlap.

---

## Section 8 — Documentation updates

### 8.1 `docs/setup.md`

Add a new section before the harness-specific setup:

```markdown
## Part 1 — Setup on the `skills` repo

1. Install the `skills-harness-bot` GitHub App on `commercetools-demo/skills` (already done in Part 0 if the App is installed org-wide).
2. Add repo secrets:
   - `HARNESS_APP_ID` (same value as the harness)
   - `HARNESS_APP_PRIVATE_KEY` (same value as the harness)
3. Copy `.github/workflows/dispatch-harness.yml` from this plan into the `skills` repo.
4. Commit and push to a test branch. Verify the workflow runs in the `skills` repo Actions tab.
5. Check the harness repo Actions tab — you should see a `b2c-validate` (or `b2b-validate`) run kicked off.

## Part 2 — Setup on the harness repo
[... rest of original setup.md content ...]
```

### 8.2 NEW: `docs/two-repo-flow.md`

A short doc explaining:
- The dispatch chain (skills repo → harness → check run)
- How to read failure: failed check on skills commit → click "Details" → opens harness Actions run
- How to manually trigger from harness side (workflow_dispatch with branch name)
- How to manually trigger from skills side (the dispatch workflow's workflow_dispatch input)
- Troubleshooting: "I pushed but nothing happened" → check dispatch workflow ran successfully, check App is installed on harness repo, check secrets

### 8.3 `docs/architecture.md`

Add a section: "Why two repos?"
- Skill authors edit skills in one place, with their own review process
- Harness changes (workflow tuning, judge prompt iteration) don't pollute skill commits
- Skill commits get clean, structured CI feedback as check runs
- Failure modes are clearer: check shows up where the changing code lives

### 8.4 `docs/troubleshooting.md`

Add entries:
- **Dispatch sent but harness didn't run** — App permissions on harness, App installation scope, secret values
- **Harness ran but no check on skills commit** — App `Checks: write` permission on `skills`, `skills_repo_sha` was passed correctly
- **Check stuck "in progress"** — workflow failed before the update step ran. The `if: always()` should prevent this; if it persists, the update script is throwing
- **Two pushes in quick succession both finished** — concurrency key is wrong; should be skills_repo_ref, not github.ref

---

## Section 9 — Recommended build order (updated)

1. Phase 0 external setup including App permissions and `skills` repo secrets
2. Create `dispatch-harness.yml` in `commercetools-demo/skills` on a test branch — verify dispatch fires
3. Harness Phase 1 skeleton + Phase 6 docs draft
4. b2c reusable workflow + `b2c-validate.yml` + `checkout-skill.mjs` + `create-check-run.mjs` + `update-check-run.mjs` — verify end-to-end manual dispatch from harness side
5. Trigger from `skills` repo branch → verify full chain works
6. Add scaffold prompt, criteria, static checks
7. Add judge prompt + parse-judge-output
8. Add Netlify + Playwright
9. Add `b2c-publish.yml` + push-to-generated-repo — verify merge to `skills/main` updates `generated-storefronts`
10. Duplicate for b2b
11. Polish docs

Each step independently testable. Stop and validate before moving on.

---

## Section 10 — What's deleted from the original plan

- `skill/` directory in the harness repo — gone entirely
- `scripts/post-summary-comment.mjs` — replaced by check run scripts
- Any reference to "copy skill from harness `skill/` directory" — replaced by clone-from-skills-repo

---

## Section 11 — What's unchanged from the original plan

- All prompts (`scaffold-b2c.md`, `scaffold-b2b.md`, `judge-b2c.md`, `judge-b2b.md`) — paths inside are `.claude/skills/...` regardless of source
- Criteria files
- Static check scripts
- Playwright tests
- Push to generated-storefronts logic
- Netlify setup and deploy
- Judge prompt and JSON output schema
- Phase 6 docs structure (just adds the two-repo doc)
