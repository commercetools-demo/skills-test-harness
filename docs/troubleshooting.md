# Troubleshooting — skills-test-harness

Common failure modes and how to fix them.

---

## "Scaffold ran out of turns"

**Symptom:** The scaffold Claude Code action step fails with a message like `Maximum turns reached` or the workflow times out during the scaffold step. The `./output/` directory is missing or incomplete.

**Cause:** The scaffold prompt asks Claude to build a full storefront, which is a large task. The default `--max-turns` value may be too low for the current skill complexity.

**Fix:**

1. Open `.github/workflows/_scaffold-and-test.yml`
2. Find the scaffold Claude Code action step — it will have `claude_args: --max-turns <N>`
3. Increase the value. Start with 250, then 300 if still failing:
   ```yaml
   claude_args: --max-turns 300
   ```
4. Commit and push to re-trigger.

**Note:** Higher turn counts consume more Claude API credits. Only increase as needed. If the scaffold consistently needs >300 turns, the prompt may need refining to scope the task more tightly — consider splitting optional features into a second pass.

---

## "Static check warnings appearing in the log"

**Symptom:** The workflow log shows `[WARN]` lines from the static check step. You want to understand or reproduce the findings locally.

**Cause:** The static check script found patterns that match known anti-patterns in the generated code.

**Reproduce locally:**

```bash
# For B2C
bash tests/static-checks-b2c.sh ./output/

# For B2B
bash tests/static-checks-b2b.sh ./output/
```

The script writes its full output to `static-check-results.txt` in the current directory.

**Note:** Static checks exit 0 and are warnings only. They do not fail the workflow. The judge LLM reads `static-check-results.txt` and uses the findings as evidence when scoring. If a warning is a false positive, the judge will discount it. If it is a genuine anti-pattern, it will lower the score.

To suppress a specific check, edit the relevant `tests/static-checks-*.sh` file and add a conditional to skip the offending pattern for known-good cases.

---

## "Netlify deploy timed out"

**Symptom:** The `wait-for-netlify-deploy.mjs` step fails with `Timed out waiting for deploy after 10 minutes` or similar. The Playwright step may be skipped or fail with no URL.

**Possible causes and fixes:**

1. **Next.js build failure inside Netlify:**
   - Download the `output.tar.gz` artifact from the failed workflow run.
   - Extract and run `npm run build` locally to see the build error.
   - Fix the underlying scaffold issue (or add a build error to the judge prompt context).

2. **Missing environment variables on the Netlify site:**
   - Go to `https://app.netlify.com/teams/cofe-pre-sales/sites`
   - Find `harness-b2c-pr` or `harness-b2b-pr`
   - Go to **Site configuration** → **Environment variables**
   - Verify all CT credentials and `SESSION_SECRET` are present
   - If missing, check that the relevant secrets are set on `skills-test-harness` and that `setup-netlify-site.mjs` is running correctly

3. **Netlify function timeout (for Next.js SSR):**
   - Go to the site in the Netlify dashboard → **Deploys** → click the failing deploy → **Deploy log**
   - Look for function errors or build errors
   - If the generated `netlify.toml` is incorrect (missing `[build]` config), add it to the scaffold prompt's required deliverables

4. **Netlify API rate limiting:**
   - The `NETLIFY_AUTH_TOKEN` PAT may have hit rate limits if many runs have fired in a short time
   - Wait a few minutes and re-trigger with `workflow_dispatch`

---

## "Publish workflow ran but `skills-scaffold` was not updated"

**Symptom:** The publish workflow (`b2c-publish.yml` or `b2b-publish.yml`) completed successfully, but the `b2c/main` or `b2b/main` branch in `commercetools-demo/skills-scaffold` was not updated.

**Check 1: GitHub App `Contents: write` permission**

1. Go to `https://github.com/organizations/commercetools-demo/settings/apps/skills-harness-bot`
2. Click **Permissions & events**
3. Verify **Repository contents** is set to **Read and write**
4. If you changed the permission, the installation may need to be re-approved — check `https://github.com/organizations/commercetools-demo/settings/installations`

**Check 2: GitHub App installed on `skills-scaffold`**

1. Go to the GitHub App's installation page:
   `https://github.com/organizations/commercetools-demo/settings/installations`
2. Click **Configure** next to `skills-harness-bot`
3. Under **Repository access**, verify that `skills-scaffold` is included
4. If the app was installed with "Selected repositories" and `skills-scaffold` was not in the list, add it

**Check 3: `push-to-generated-repo.mjs` errors in workflow log**

1. Open the failing workflow run
2. Find the `push-to-generated-repo` step
3. Look for error messages — common causes:
   - `--force-with-lease` rejected because another push happened concurrently (retry)
   - Authentication error (token minting failure — check App ID and private key secret)
   - The `skills-scaffold` repo doesn't exist (complete Step 0.2 in setup.md)

---

## "Judge JSON malformed"

**Symptom:** The `parse-judge-output.mjs` step fails with a JSON parse error, or `judge-result.json` is missing or contains prose instead of valid JSON.

**Cause:** The judge Claude Code action produced output that was not strictly JSON, or wrote to a file other than `judge-result.json`, or included markdown code fences around the JSON.

**Fix:**

1. Open the workflow run and download the artifacts
2. Check whether `judge-result.json` exists in the artifact
3. If it exists, inspect its contents — common issues:
   - JSON wrapped in markdown code fences (\`\`\`json ... \`\`\`) — the parse script cannot handle fences
   - Extra prose before or after the JSON object
   - Trailing comma or other JSON syntax error

**To fix the prompt:**

1. Open `prompts/judge-b2c.md` or `prompts/judge-b2b.md`
2. Strengthen the output format instruction. Add explicit text like:
   ```
   IMPORTANT: Your only output must be a single valid JSON object written to the file
   `judge-result.json`. Do not wrap it in markdown code fences. Do not add any text
   before or after the JSON. Do not write to any other file. Do not run any shell
   commands. Only read files and write judge-result.json.
   ```
3. Also add the expected schema inline so the model knows the exact required shape

You can inspect the raw Claude output by looking at the workflow step logs — the Claude Code action logs each tool call, so you can see what the model attempted to write.

---

## "Claude Code Action fails with auth error"

**Symptom:** The scaffold or judge Claude Code action step fails immediately with an authentication error such as `401 Unauthorized`, `Invalid token`, or `Authentication failed`.

**Possible causes and fixes:**

1. **`CLAUDE_CODE_OAUTH_TOKEN` secret is not set:**
   - Go to `https://github.com/commercetools-demo/skills-test-harness/settings/secrets/actions`
   - Verify `CLAUDE_CODE_OAUTH_TOKEN` is in the list
   - If missing, complete Step 0.3 in setup.md

2. **Token has expired:**
   - OAuth tokens expire. Regenerate by running `claude setup-token` locally and updating the secret.
   - Go to GitHub secrets, delete the old `CLAUDE_CODE_OAUTH_TOKEN`, and add the new value

3. **Token was revoked:**
   - If the Claude account's OAuth session was revoked (e.g. account password change, explicit session revocation), the token is invalid
   - Run `claude setup-token` to get a fresh token and update the secret

4. **Secret not passed to the reusable workflow:**
   - The entry workflows (`b2c-pr.yml`, etc.) must include `secrets: inherit` in the job definition
   - Verify this is present:
     ```yaml
     jobs:
       scaffold-and-test:
         uses: ./.github/workflows/_scaffold-and-test.yml
         with:
           ...
         secrets: inherit
     ```
   - Without `secrets: inherit`, the called workflow cannot access the parent's secrets

5. **Typo in secret name:**
   - The workflow references `secrets.CLAUDE_CODE_OAUTH_TOKEN`
   - Verify the secret is named exactly `CLAUDE_CODE_OAUTH_TOKEN` (all caps, underscores)

---

## Two-repo dispatch issues

### Dispatch sent but harness didn't run
1. Check the `dispatch-harness.yml` workflow ran successfully in the skills repo Actions tab
2. Verify the GitHub App is installed on `commercetools-demo/skills-test-harness`
3. Check `HARNESS_APP_ID` and `HARNESS_APP_PRIVATE_KEY` secrets on the skills repo match the harness repo values
4. Verify the App has `Contents: write` and `Metadata: read` on the harness repo (needed for dispatch)

### Harness ran but no check run appeared on the skills commit
1. Verify the GitHub App has `Checks: write` permission on `commercetools-demo/skills`
2. Confirm `skills_repo_sha` was included in the dispatch payload (`client_payload.skills_repo_sha`)
3. Look at the "Create in-progress check run" step in the harness run logs for errors

### Check run stuck "in_progress"
The `update-check-run.mjs` step runs with `if: always()`. If the check is stuck, look at the harness run — the update step itself failed (likely a GH_TOKEN permission issue). Check the App has `Checks: write` on the skills repo.

### Two pushes both completed instead of the second cancelling the first
The concurrency key must be the skills repo branch, not the harness `github.ref`. Verify `b2c-validate.yml` has:
```yaml
concurrency:
  group: b2c-validate-${{ github.event.client_payload.skills_repo_ref || inputs.skills_repo_ref }}
```
