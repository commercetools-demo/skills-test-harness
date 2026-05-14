This is an automated CI run. Do not ask any questions, request clarification, or wait for user input at any point. Make reasonable assumptions and proceed autonomously to completion.

Generate a complete B2C storefront.

## Build order

1. project-setup
2. simple home page
3. product-listing
4. product-detail
5. cart
6. checkout
7. customer-auth
8. search-facets
9. performance

## Output location

Write ALL generated files under `./output/`. You may use subdirectories as the skill prescribes (e.g. `output/site/`, `output/tools/`). The Next.js app root must contain a `package.json`.

## Scope

**Implement all Core features**

**Skip ALL Optional Features.** Do not implement: superuser, bopis, bundles, or promotions.

## Required deliverables

After all phases are complete, verify:

- `npm run build` passes without errors
- `tsc --noEmit` passes without errors
- `output/netlify.toml` exists with correct Next.js adapter configuration
- `output/.env.example` exists listing every required environment variable
- `output/README.md` exists with setup and deployment instructions

Fix any build or type errors before proceeding to the summary.

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
