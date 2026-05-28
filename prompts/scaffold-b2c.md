This is an automated CI run. Do not ask any questions, request clarification, or wait for user input at any point. Make reasonable assumptions and proceed autonomously to completion.

Generate a complete production ready B2C storefront connected to commercetools.

## Required features

1. simple home page
2. use new product search api
3. product-listing + facets
4. product-detail
5. cart
6. checkout: create complete integration with paymentflow of commercetools checkout but keep the application key as const
7. customer authentication and registration
8. search page + facets
9. wishlist

## Output location

Write ALL generated files under `./output/`. You may use subdirectories as the skill prescribes (e.g. `output/site/`, `output/tools/`). The Next.js app root must contain a `package.json`.

## Scope

**Implement all Core features**

**Skip ALL Optional Features.** Do not implement: superuser, bopis, bundles or promotions.

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
