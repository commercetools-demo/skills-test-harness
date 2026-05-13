This is an automated CI run. Do not ask any questions, request clarification, or wait for user input at any point. Make reasonable assumptions and proceed autonomously to completion.

Read the skill file at `.claude/skills/commercetools-b2b-storefront/SKILL.md` in full.
Then read every file under `.claude/skills/commercetools-b2b-storefront/references/` in full.

Using the knowledge from those files, generate a complete B2B storefront.

## Output location

Write ALL generated files under `./output/`. You may use subdirectories as the skill prescribes (e.g. `output/site/`, `output/tools/`). The Next.js app root must contain a `package.json`.

## Build order

Follow the **Core — B2B Foundation** section of SKILL.md exactly, executing each phase in this order:

1. project-setup
2. session-and-bu
3. product-listing
4. product-detail
5. cart
6. checkout
7. customer-auth
8. permissions

After completing all Core phases, implement these **B2B Feature Modules** in order:

1. quotes
2. approval-workflows
3. dashboard

Complete each phase fully before starting the next.

## Scope

**Skip ALL Optional Features.** Do not implement: superuser or wishlists.

## Required deliverables

After all phases are complete, verify:

- `npm run build` passes without errors
- `tsc --noEmit` passes without errors
- `output/netlify.toml` exists with correct Next.js adapter configuration
- `output/.env.example` exists listing every required environment variable
- `output/README.md` exists with setup and deployment instructions

Fix any build or type errors before proceeding to the summary.

## B2B requirements

Strictly implement these B2B-specific requirements:

- **as-associate chain**: every write operation (cart mutations, order creation, quote actions) must use the as-associate endpoint chain; never bypass it
- **Session B2B fields**: the session object must include `businessUnitKey`, `storeKey`, `distributionChannelId`, `supplyChannelId`, and `productSelectionId`; all five fields must be written atomically in a single session update — never update them individually
- **Channel-scoped pricing**: all product search and product detail queries must include `distributionChannelId` and `supplyChannelId` from the session to return channel-correct prices
- **CT login endpoint**: use the commercetools login endpoint as specified in SKILL.md; do not call the CT auth API directly from client components
- **lib/ct server-only**: all files under `lib/ct/` must include `import 'server-only'` at the top; CT credentials must never reach the browser

## Anti-patterns to honour

Strictly follow every anti-pattern listed in SKILL.md. At minimum ensure:

- BFF architecture: all commercetools API calls happen server-side only; no CT credentials leak to the browser
- Session secrets are never prefixed with `NEXT_PUBLIC_`
- The login endpoint follows the pattern specified in SKILL.md
- Cart operations always send and respect the cart `version` field to prevent version conflicts
- Locale strings use the correct format specified in SKILL.md (e.g. `en-US` not `en_US`)

## Summary block

When all work is done, output a structured summary in this exact format:

```
SCAFFOLD SUMMARY
================
Files created: <count>
npm run build: <PASSED | FAILED — <error summary>>
tsc --noEmit: <PASSED | FAILED — <error summary>>
netlify.toml: <present | missing>
.env.example: <present | missing>
README.md: <present | missing>
B2B requirements:
  - as-associate chain: <yes | no — reason>
  - Session B2B fields atomic write: <yes | no — reason>
  - Channel-scoped pricing: <yes | no — reason>
  - CT login endpoint pattern: <yes | no — reason>
  - lib/ct server-only: <yes | no — reason>
Anti-patterns respected:
  - BFF architecture: <yes | no — reason>
  - Session secrets not NEXT_PUBLIC_: <yes | no — reason>
  - Cart versioning: <yes | no — reason>
  - Locale format: <yes | no — reason>
```
