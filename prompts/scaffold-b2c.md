Read the skill file at `.claude/skills/commercetools-b2c-storefront/SKILL.md` in full.
Then read every file under `.claude/skills/commercetools-b2c-storefront/references/` in full.

Using the knowledge from those files, generate a complete B2C storefront in `./output/`.

## Build order

Follow the **Core — Green-Field Build** section of SKILL.md exactly, executing each phase in this order:

1. project-setup
2. ct-client
3. product-listing
4. product-detail
5. cart
6. checkout
7. customer-auth
8. search-facets
9. performance

Complete each phase fully before starting the next.

## Scope

**Skip ALL Optional Features.** Do not implement: superuser, bopis, bundles, or promotions.

## Required deliverables

After all phases are complete, verify:

- `npm run build` passes without errors
- `tsc --noEmit` passes without errors
- `output/netlify.toml` exists with correct Next.js adapter configuration
- `output/.env.example` exists listing every required environment variable
- `output/README.md` exists with setup and deployment instructions

Fix any build or type errors before proceeding to the summary.

## Anti-patterns to honour

Strictly follow every anti-pattern listed in SKILL.md. At minimum ensure:

- BFF architecture: all commercetools API calls happen server-side only; no CT credentials leak to the browser
- Session secrets are never prefixed with `NEXT_PUBLIC_`
- The login endpoint follows the pattern specified in SKILL.md (do not call the CT API directly from client components)
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
Anti-patterns respected:
  - BFF architecture: <yes | no — reason>
  - Session secrets not NEXT_PUBLIC_: <yes | no — reason>
  - CT login endpoint pattern: <yes | no — reason>
  - Cart versioning: <yes | no — reason>
  - Locale format: <yes | no — reason>
```
