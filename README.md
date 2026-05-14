# skills-test-harness

> NOTE: This is NOT official commercetools code and NOT production ready. Use at your own risk.

A CI harness that validates [commercetools Claude Code plugins](https://github.com/commercetools-demo/commercetools-plugin) by autonomously generating full storefronts and scoring the output.

On every push to `commercetools-demo/commercetools-plugin`, the harness:

1. Checks out the plugin repo and installs it as a local marketplace
2. Runs Claude Code (agent mode) to scaffold a complete Next.js storefront under `./output/`
3. Runs static checks (warn-only) and a judge LLM pass to score the output (0–100)
4. Optionally deploys to Netlify and runs Playwright E2E tests
5. Pushes the generated code to [`commercetools-demo/skills-scaffold`](https://github.com/commercetools-demo/skills-scaffold)
6. Reports results as a GitHub check run on the originating commit in the plugin repo
7. Notifies a Slack channel with the score and preview URL

## Repository layout

```
.github/
  workflows/
    _scaffold-and-test.yml   # reusable core workflow
    b2c-validate.yml         # triggered on b2c-validate dispatch / workflow_dispatch
    b2c-publish.yml          # triggered on b2c-publish dispatch
    b2b-validate.yml
    b2b-publish.yml
docs/
  plugin-repo/
    dispatch-harness.yml     # reference workflow to copy into commercetools-demo/commercetools-plugin
prompts/
  scaffold-b2c.md            # scaffold prompt for the B2C skill
  scaffold-b2b.md            # scaffold prompt for the B2B skill
  judge-b2c.md               # judge prompt for B2C scoring
  judge-b2b.md               # judge prompt for B2B scoring
scripts/
  checkout-skill.mjs         # clones the plugin repo into ./plugin-source/
  create-check-run.mjs       # creates an in-progress check run on the plugin commit
  update-check-run.mjs       # marks the check run completed with score + links
  parse-judge-output.mjs     # extracts score and violation counts from judge-result.json
  push-to-generated-repo.mjs # pushes ./output to skills-scaffold (strips node_modules etc.)
  setup-netlify-site.mjs     # finds/creates a Netlify site and deploys via zip upload
  wait-for-netlify-deploy.mjs
  post-slack-notification.mjs
tests/
  static-checks-b2c.sh
  static-checks-b2b.sh
  playwright/
```

## How it works

### Validate vs Publish

| Mode | Trigger | Netlify deploy | Target branch in skills-scaffold |
|------|---------|----------------|----------------------------------|
| **validate** | Push to any branch in plugin repo | yes | `<skill>/preview/<branch-name>` |
| **publish** | Push to `main` in plugin repo | no | `<skill>/main` |

### Scoring

The judge prompt reads the generated output and writes `judge-result.json` with a score from 0 to 100:

- `-20` per critical violation
- `-10` per high violation
- `-5` per medium violation

The score and top violations are reported as a GitHub check run summary on the originating plugin commit.

## Setup

### GitHub App

Create a GitHub App (`HARNESS_APP_ID`) with:
- **Read & write** access to: Checks, Contents on `commercetools-demo/commercetools-plugin`
- **Read & write** access to: Contents on `commercetools-demo/skills-scaffold`

Install it on both repositories. Store the private key as `HARNESS_APP_PRIVATE_KEY` in the harness repo secrets.

### GitHub Environments

Create two environments in this repo — `b2c` and `b2b` — and add the following to each:

**Secrets**

| Name | Description |
|------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code OAuth token |
| `HARNESS_APP_PRIVATE_KEY` | GitHub App private key |
| `NETLIFY_AUTH_TOKEN` | Netlify personal access token |
| `CTP_CLIENT_SECRET` | commercetools API client secret |
| `SESSION_SECRET` | JWT session signing secret |

**Variables**

| Name | Description |
|------|-------------|
| `HARNESS_APP_ID` | GitHub App ID |
| `CTP_AUTH_URL` | e.g. `https://auth.europe-west1.gcp.commercetools.com` |
| `CTP_API_URL` | e.g. `https://api.europe-west1.gcp.commercetools.com` |
| `CTP_PROJECT_KEY` | commercetools project key |
| `CTP_CLIENT_ID` | commercetools API client ID |
| `CTP_SCOPES` | space-separated scopes |

### Plugin repo — dispatch workflow

Copy `docs/plugin-repo/dispatch-harness.yml` into `.github/workflows/` of `commercetools-demo/commercetools-plugin`. This workflow detects changed skills on push and fires the appropriate `repository_dispatch` event (`b2c-validate`, `b2c-publish`, etc.) to this harness repo.

## Per-run instructions via commit message

You can inject additional instructions into a harness run by adding a `[harness]` block to the commit message in `commercetools-demo/commercetools-plugin`:

```
Add new promotions reference

This adds promotions docs to the B2C skill.

[harness]
Also implement the promotions feature described in references/promotions.md.
Verify that discount codes are applied correctly at checkout.
[/harness]
```

The dispatch workflow extracts the content between `[harness]` and `[/harness]` and passes it as `extra_instructions` to the harness. Claude Code sees it appended to the base scaffold prompt under an `## Additional test instructions` heading.

**Use cases:**

- Testing a new optional feature before it graduates to the base prompt: _"Also implement the promotions feature described in `references/promotions.md`"_
- Verifying a specific bug fix: _"Ensure cart versioning fix is applied — never use a stale version number"_
- Narrowing scope for a branch run: _"Skip the dashboard phase and focus only on the quotes module"_

You can also add instructions manually when triggering `workflow_dispatch` — the `extra_instructions` input on the validate workflows accepts the same freeform text.
