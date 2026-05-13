# Grading Criteria — B2C Storefront

This document is the authoritative rubric for the judge LLM when evaluating a scaffolded B2C commercetools storefront. Score each item independently. Evidence must come from the generated code in `./output/`.

---

## CRITICAL — 20 points each

Failing any Critical item is a blocking violation. A non-empty `critical_violations` array will fail the workflow regardless of total score.

### CRIT-1: BFF Architecture

- `lib/ct/*` files are server-only (contain `import 'server-only'` or are exclusively used in Server Components / Route Handlers).
- No file that contains `'use client'` imports anything from `@/lib/ct` (or equivalent path).
- No environment variable beginning with `NEXT_PUBLIC_CTP` appears anywhere in the codebase.

**Pass condition:** Zero client files import from `lib/ct/`. No `NEXT_PUBLIC_CTP*` env vars present.

### CRIT-2: Cart Versioning

- Every cart write operation (add line item, remove line item, update quantity, apply discount, set shipping address, etc.) fetches the current cart version immediately before the write.
- The cart mutation handler retries on HTTP 409 `ConcurrentModification` by re-fetching the cart and retrying with the updated version.

**Pass condition:** All cart write Route Handlers follow the fetch-version → write → retry-on-409 pattern.

### CRIT-3: Session Secrets

- `SESSION_SECRET` is a server-only environment variable (accessed only in `lib/session.ts` or equivalent, never exported to the client).
- `CTP_CLIENT_SECRET` is a server-only environment variable (accessed only in `lib/ct/client.ts` or equivalent).
- Neither appears in any file containing `'use client'`.
- Neither appears as a `NEXT_PUBLIC_*` variable.

**Pass condition:** Both secrets accessed only in server-side modules.

### CRIT-4: CT Login Endpoint

- User login calls `apiRoot.login().post({ body: { ... } })`.
- The legacy `apiRoot.customers().login()` endpoint is NOT used anywhere.

**Pass condition:** `apiRoot.login().post()` is used; `apiRoot.customers().login()` does not appear.

### CRIT-5: Cart Creation — shippingMode

- Every call that creates a new cart includes `shippingMode: 'Single'` in the cart draft body.
- This applies to both anonymous cart creation and post-login cart creation.

**Pass condition:** All `carts().post()` calls include `shippingMode: 'Single'`.

---

## HIGH — 10 points each

### HIGH-1: Parallel Fetching

- Independent server-side data fetches are made concurrently using `Promise.all([...])`.
- Examples: fetching category tree and featured products together on the homepage; fetching product details and related products together on PDP.

**Pass condition:** At least two instances of `Promise.all` used for independent CT API calls in Server Components or Route Handlers.

### HIGH-2: Type Safety at CT Boundary

- React components and hooks import types from `@/lib/types.ts` (or a `types/` directory), NOT directly from `@/lib/ct/*`.
- CT SDK response types (`ProductProjection`, `Cart`, `Customer`, etc.) do not appear in component files.

**Pass condition:** No CT SDK type imports in component files; all shared types come from `lib/types.ts` or equivalent.

### HIGH-3: Anonymous Cart Merge

- When a logged-in user completes authentication, the existing anonymous `cartId` from the session is passed as `anonymousCartId` in the login payload.
- This causes CT to automatically merge the anonymous cart into the customer's active cart.

**Pass condition:** `anonymousCartId` is included in the `apiRoot.login().post()` body when a session `cartId` exists.

### HIGH-4: SWR Cache Invalidation

- After login, `mutate(KEY_CART)` and `mutate(KEY_ACCOUNT)` are called to refresh client-side SWR caches.
- After logout, same keys are mutated (cleared).
- After order placement, `KEY_CART` is mutated.

**Pass condition:** `KEY_CART` and `KEY_ACCOUNT` (or equivalent SWR keys) are mutated in login, logout, and order handlers.

### HIGH-5: CT Type Boundary in Mappers

- `lib/ct/` functions return mapped app types (from `lib/types.ts`), not raw CT SDK types.
- A `lib/mappers/` directory (or equivalent) exists with mapping functions that transform CT responses to app types before they leave `lib/ct/`.

**Pass condition:** `lib/mappers/` exists; `lib/ct/` functions return app types, not `ProductProjection`, `Cart`, etc.

---

## MEDIUM — 5 points each

### MED-1: Product Search API v2

- Product listing and search use the `/products/search` endpoint (`apiRoot.products().search().post()`), not the legacy `productProjections().search()`.

**Pass condition:** `products().search().post()` is used for product listing; no `productProjections().search()` calls.

### MED-2: unstable_cache on Static Data

- The category tree fetch is wrapped with Next.js `unstable_cache` with a TTL (e.g., 3600 seconds).
- Attribute labels / product type attribute fetch is wrapped with `unstable_cache` with a TTL.

**Pass condition:** `unstable_cache` used for category tree and attribute label fetches with a `revalidate` value.

### MED-3: Cart State Cleared After Order

- After `createOrderFromCart` succeeds, the `cartId` is removed from the session.
- The cart is not reused after order placement.

**Pass condition:** Session `cartId` deletion occurs in the order-creation Route Handler after a successful CT order.

### MED-4: Locale Format Duality

- URL locale format is `en-us` (lowercase hyphen, e.g. in Next.js routes).
- CT API locale format is `en-US` (mixed case) — mapped before API calls.
- A `COUNTRY_CONFIG` (or equivalent) maps between URL locale and CT locale, currency, and country code.

**Pass condition:** URL-to-CT locale mapping exists; CT API calls use `en-US` format, not `en-us`.

---

## SMOKE — presence checks (pass/fail, no partial credit)

These checks verify basic structural completeness. Fail any smoke check = note in `passed_checks` as false.

| ID | Check |
|---|---|
| SMOKE-1 | Homepage route exists (`app/[locale]/page.tsx` or equivalent locale-wrapped root page) |
| SMOKE-2 | Category listing route exists (e.g. `app/[locale]/[category]/page.tsx` or `app/[locale]/c/[slug]/page.tsx`) |
| SMOKE-3 | PDP route exists with a variant selector component |
| SMOKE-4 | Cart context or cart hook exists (`CartContext`, `useCart`, or equivalent) |
| SMOKE-5 | Checkout route exists (e.g. `app/[locale]/checkout/page.tsx`) |

---

## Scoring Reference

| Tier | Points each | Max contribution |
|---|---|---|
| CRITICAL (5 items) | 20 | 100 |
| HIGH (5 items) | 10 | 50 |
| MEDIUM (4 items) | 5 | 20 |
| SMOKE (5 items) | pass/fail | qualitative |
| **Total** | | **170** |

A passing score is considered 120+ with zero critical violations. The judge must still report all violations even on a passing score.

---

## Output Format

The judge must produce `judge-result.json` with this exact structure:

```json
{
  "score": 0,
  "critical_violations": [
    { "item": "CRIT-1", "evidence": "app/components/Cart.tsx imports from @/lib/ct/cart" }
  ],
  "high_violations": [
    { "item": "HIGH-2", "evidence": "ProductCard.tsx imports ProductProjection from @commercetools/platform-sdk" }
  ],
  "medium_violations": [],
  "passed_checks": ["CRIT-2", "CRIT-3", "HIGH-1", "SMOKE-1"],
  "notes": "Overall well-structured BFF. Cart versioning is solid. Missing mapper layer."
}
```

Do not include explanatory prose outside this JSON structure. Write ONLY `judge-result.json`.
