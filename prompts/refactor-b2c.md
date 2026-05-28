You are a code refactoring agent. Your only job is to read the judge feedback and fix all critical and high violations in the generated storefront.

**Do not run npm install or build commands.**

## Step 1 — Locate the app root

Run `find ./output -name "package.json" -not -path "*/node_modules/*" | head -1` to find the app's `package.json`. All file paths below are relative to that directory (e.g. if it is `./output/site/package.json`, the app root is `./output/site/`).

## Step 2 — Read the judge result

Read `judge-result.json` in full. Note every critical and high violation — the `item` (criterion name) and `evidence` (file path and pattern).

All paths in the evidence are relative to `./output/`. For example, if the evidence says `site/app/[locale]/cart/page.tsx`, the full path is `./output/site/app/[locale]/cart/page.tsx`.

## Step 3 — Read the relevant files

For each violation, read the file(s) named in the `evidence` field using the full `./output/<path>` form. Also read the `lib/ct/` directory under the app root in full to understand what localized utilities are available.

## Step 4 — Fix every critical and high violation

Work through the violations one by one. Apply the minimal change needed — do not refactor unrelated code.

**Localized product strings (`"localized product strings via lib/ct"`)**
Product fields such as `name`, `description`, and `slug` must never be read directly from CT API objects. Replace all direct accesses (e.g. `product.name`, `lineItem.name`, `item.description`) with the appropriate localized helper from `./output/lib/ct/`. Apply this in every affected file: product detail, cart, order, search/listing, wishlist, and shared product card components.

**No `'use client'` in page.tsx (`"no 'use client' in page.tsx"`)**
Remove the `'use client'` directive from the top of any file named `page.tsx`. If the page needs client-side interactivity, extract that logic into a separate client component (e.g. `*-client.tsx` or inside `./output/components/`) that IS marked `'use client'`, then import it into the page.

**No `<select>`/`<input>` in server components (`"no <select>/<input> in server component"`)**
A server component is any `.tsx` file that does NOT have `'use client'` at the top AND is not named `page.tsx`. Move any `<select>` or `<input>` elements out of server components into a new client component file (add `'use client'` at the top), and import that client component into the server component.

For all other critical and high violations listed in `judge-result.json`, read the evidence and apply whatever fix is needed to satisfy the criterion.

## Step 5 — Run type checking

From the app root directory located in Step 1, run:

```
npx tsc --noEmit
```

If there are type errors, fix them before proceeding. Re-run until the output is clean.

## Step 6 — Write a summary

After all fixes are applied, write `refactor-summary.txt` listing each violation fixed and the change made (one line per fix).

**Do not run npm install or build commands.**
