# Architecture — skills-test-harness

This document explains the design decisions behind the CI harness. Each decision was made deliberately; this doc captures the reasoning so future maintainers understand why things work the way they do.

---

## Why PR flow is ephemeral

The PR flow scaffolds a storefront, grades it, optionally deploys it to Netlify, and then discards the generated code. Nothing is committed to the harness repo or any other repo.

**Rationale:**

Generated storefronts can be tens of thousands of lines of code. Committing them to the harness repo on every push would:
- Bloat the repo history with machine-generated code that is not the source of truth
- Create merge conflicts when multiple branches are tested in quick succession
- Make the harness repo harder to read and reason about

The deliverable of a PR run is the **judge score and violation report**, not the code itself. The code is uploaded as a compressed workflow artifact, which is retained for 30 days. If you need to inspect the generated output for a specific run, download the artifact from the workflow run page.

The canonical generated code (the output of a merge to `main`) lives in `skills-scaffold`. The PR flow exists only to validate that a skill change doesn't introduce regressions before it is merged.

---

## Why publish flow uses one repo with per-skill branches

The publish flow pushes generated code to `commercetools-demo/skills-scaffold`. Rather than one repo per skill, both skills share a single repo with separate branches: `b2c/main` and `b2b/main`.

**Rationale:**

- **Fewer repos to manage:** GitHub App permissions, Netlify site wiring, and access control apply to one repo instead of two.
- **Correlated history:** If you want to see what the B2C and B2B scaffolds looked like at the same harness commit, both are in one place.
- **Conventional branch naming:** The `skill/main` pattern (e.g. `b2c/main`) maps cleanly onto Netlify's branch deploy feature — you can wire `b2c/main` → `b2c-canonical.netlify.app` and `b2b/main` → `b2b-canonical.netlify.app` without any custom routing logic.

The publish script (`scripts/push-to-generated-repo.mjs`) uses `--force-with-lease` so that concurrent publishes do not silently clobber each other. Combined with the queue concurrency policy (see below), only one publish runs at a time per skill.

---

## Why the same OAuth token for scaffold and judge

Both the scaffold step and the judge step use `CLAUDE_CODE_OAUTH_TOKEN`. There is no separate token for each.

**Rationale:**

The OAuth token represents a Claude session. Both steps need identical API access — they both call the Claude API with different prompts. There is no security advantage to using different tokens; the scope of the token is the same for both operations.

Using a single token simplifies secret management: one token to rotate, one token to audit, one token to revoke if compromised.

The two Claude Code action invocations use different `prompt_file` inputs (`scaffold-${slug}.md` vs `judge-${slug}.md`), which is where their behavior diverges. The token is just the authentication credential.

---

## Why concurrency rules differ between PR and publish flows

### PR flow: `cancel-in-progress: true`

```yaml
concurrency:
  group: b2c-pr-${{ github.ref }}
  cancel-in-progress: true
```

When you push multiple commits to a branch in quick succession, you want the latest commit's scaffold run, not all of them. Earlier runs become irrelevant the moment the next commit lands. Canceling in-progress runs:
- Saves Claude API credits (scaffold runs can consume many turns)
- Saves Netlify deploy slots
- Ensures the PR comment reflects the latest state of the branch

The concurrency group is scoped to the branch ref (`github.ref`), so two different branches can run simultaneously.

### Publish flow: `cancel-in-progress: false` (queue)

```yaml
concurrency:
  group: b2c-publish
  cancel-in-progress: false
```

A publish run pushes code to `skills-scaffold`. If two publishes run simultaneously:
- They would both scaffold independently and then both try to force-push `b2c/main`
- The second push would clobber the first, even if the first's output was higher quality
- `--force-with-lease` would cause one of the pushes to fail non-deterministically

Queuing publishes (not canceling) ensures each one completes before the next begins. In practice, multiple simultaneous merges to `main` with `skill/` path changes are rare; queuing adds at most one scaffold run's wait time.

---

## Why both skills share one harness repo

B2C and B2B skills are tested by the same harness infrastructure: the same reusable workflow, the same judge architecture, the same Playwright harness, the same scripts. Splitting them into two repos would mean:

- Duplicating `_scaffold-and-test.yml` across two repos
- Syncing changes to scripts and prompts across two repos
- Managing permissions and secrets on two repos

The skills differ in their `prompts/`, `tests/criteria-*.md`, `tests/static-checks-*.sh`, and `tests/playwright/b2c|b2b/` directories. These differences are handled by the `skill_slug` input (`b2c` or `b2b`) that parameterizes the reusable workflow. Everything else is shared.

---

## Why static checks warn only (judge is authoritative)

`tests/static-checks-b2c.sh` and `tests/static-checks-b2b.sh` both exit 0 regardless of findings. They never fail the workflow on their own.

**Rationale:**

Static grep-based checks have inherent false-positive rates. A check like "does `lib/ct/` get imported in a `'use client'` file?" can fire on a comment, a disabled code path, or a test fixture. Failing the workflow on a false positive creates friction that discourages running the checks at all.

The checks serve a different purpose: they produce `static-check-results.txt`, which the judge LLM reads as additional evidence before scoring. The judge can discount false positives using its understanding of context; a grep tool cannot.

If a pattern is important enough that no exception should ever be tolerated, it belongs in the judge's CRITICAL tier (which does fail the workflow), not in the static checks.

The PLAN.md noted that static checks "exit 1 on any violation" — that was an earlier design. The current decision is to warn only and let the judge be the authoritative gate, which is more robust and less noisy in practice. The judge score threshold (see `scripts/parse-judge-output.mjs`) is the actual workflow gate.

---

## Data flow summary

```
Push to branch (non-main, skill/* paths)
         │
         ▼
b2c-pr.yml / b2b-pr.yml
  └─ calls _scaffold-and-test.yml (publish=false, deploy=true)
              │
              ├─ Claude Code (scaffold) → ./output/
              ├─ static-checks-${slug}.sh → static-check-results.txt
              ├─ Claude Code (judge) → judge-result.json
              ├─ parse-judge-output.mjs → fail if critical_violations
              ├─ setup-netlify-site.mjs → deploy ./output/
              ├─ wait-for-netlify-deploy.mjs → preview_url
              ├─ Playwright tests against preview_url
              ├─ Upload artifacts (judge-result.json, output.tar.gz, playwright-report/)
              └─ post-summary-comment.mjs → PR/commit comment

Push to main (skill/* paths)
         │
         ▼
b2c-publish.yml / b2b-publish.yml
  └─ calls _scaffold-and-test.yml (publish=true, deploy=false)
              │
              ├─ Claude Code (scaffold) → ./output/
              ├─ static-checks-${slug}.sh → static-check-results.txt
              ├─ Claude Code (judge) → judge-result.json
              ├─ parse-judge-output.mjs → fail if critical_violations
              ├─ push-to-generated-repo.mjs → skills-scaffold ${slug}/main
              ├─ Upload artifacts
              └─ post-summary-comment.mjs → commit comment with scaffold link
```

---

## Why two repos?

**Separation of concerns.** Skill authors edit `commercetools-demo/skills` with their own PR review process. Harness authors tune prompts, workflows, and tests in `skills-test-harness`. These are different change frequencies and different reviewers.

**Clean CI signal.** A check run appears directly on the skills commit, where the changing code lives. The developer sees pass/fail alongside their other CI checks — they don't need to navigate to a separate repo.

**Harness changes don't pollute skill history.** Prompt iteration or test tuning in the harness doesn't add noise to the skills repo's git log.

**Failure isolation.** When a run fails, it's immediately clear whether the failure is in the skill (code quality) or in the harness (CI infrastructure). The check run points to the harness run; harness infrastructure failures don't appear as skill failures.
