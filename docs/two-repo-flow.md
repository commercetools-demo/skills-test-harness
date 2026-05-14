# Two-repo flow — skills-test-harness

This document explains how the `commercetools-demo/commercetools-plugin` repo and the `commercetools-demo/skills-test-harness` repo work together via `repository_dispatch`.

---

## Overview

```
commercetools-demo/commercetools-plugin
  Push to branch or main
         │
         ▼
  .github/workflows/dispatch-harness.yml
  - Detects which skill changed (b2c / b2b)
  - Determines suffix: validate (non-main) or publish (main)
  - Mints a GitHub App token scoped to skills-test-harness
  - Sends repository_dispatch event: b2c-validate / b2b-validate / b2c-publish / b2b-publish
         │
         ▼
commercetools-demo/skills-test-harness
  .github/workflows/b2c-validate.yml (or b2b / publish variant)
  - Receives client_payload: skills_repo_ref, skills_repo_sha, trigger_actor
  - Creates an in-progress check run on the plugin commit (skills_repo_sha)
  - Clones the plugin repo into ./plugin-source/ and installs it as a local marketplace
  - Runs scaffold → static checks → judge → Playwright
  - Updates the check run to completed (success or failure)
         │
         ▼
  Check run appears on the plugin commit in commercetools-demo/commercetools-plugin
```

---

## Reading a failure

When a run fails, the check run appears directly on the plugin commit that triggered it.

1. Open the commit in `commercetools-demo/commercetools-plugin` (e.g. from the branch's commit list or a PR's checks tab).
2. Find the check named `b2c-validate` or `b2b-validate` — it will show a red X.
3. Click **Details** next to the failing check.
4. This opens the corresponding workflow run in `skills-test-harness` with full step-by-step logs.

---

## Manual triggers

### From the plugin repo

Run the `dispatch-harness.yml` workflow via `workflow_dispatch`:

1. Go to `commercetools-demo/commercetools-plugin` → **Actions** → **Dispatch to test harness**.
2. Click **Run workflow**.
3. Choose the branch and the `skill` input (`b2c`, `b2b`, or `both`).
4. The dispatch will fire with the `validate` suffix (because `workflow_dispatch` is not on `main` push), and a check run will appear on the HEAD commit of the selected branch.

### From the harness repo

Run the validate workflow directly via `workflow_dispatch`:

1. Go to `commercetools-demo/skills-test-harness` → **Actions** → select `b2c-validate` or `b2b-validate`.
2. Click **Run workflow** and fill in the `skills_repo_ref` input (e.g. `my-feature-branch`).
3. Note: when triggered this way, no `skills_repo_sha` is available, so **no check run is created on the plugin commit**. The run still executes and produces artifacts, but the result will not appear in the plugin repo's checks UI.

---

## Troubleshooting

### Pushed plugin but nothing happened

1. Check the **Actions** tab of `commercetools-demo/commercetools-plugin` — confirm `dispatch-harness.yml` triggered and completed. If it did not trigger, verify the `on.push.paths` filter matches the changed files.
2. Verify the GitHub App (`skills-harness-bot`) is installed on `commercetools-demo/skills-test-harness`.
3. Check that `HARNESS_APP_ID` and `HARNESS_APP_PRIVATE_KEY` secrets are set on `commercetools-demo/commercetools-plugin` (Settings → Secrets → Actions). These must match the values on the harness repo.

### Harness ran but no check appeared on the plugin commit

1. Verify the GitHub App has `Checks: write` permission on `commercetools-demo/commercetools-plugin`.
2. Confirm the dispatch payload included `skills_repo_sha` — check the "Dispatch b2c" / "Dispatch b2b" step output in the plugin repo Actions run.
3. Look at the "Create in-progress check run" step in the harness workflow run logs for any API errors.

### Check stuck "in_progress"

The `update-check-run` step in the harness workflow is configured with `if: always()`, which means it runs even when earlier steps fail. If the check is stuck in progress, the update step itself failed. Open the harness run and look for errors in that step — the most common cause is a `GH_TOKEN` permission issue (App does not have `Checks: write` on the plugin repo).
