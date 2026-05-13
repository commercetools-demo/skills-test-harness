# Grading Criteria — B2B Storefront

This document is the authoritative rubric for the judge LLM when evaluating a scaffolded B2B commercetools storefront. Score each item independently. Evidence must come from the generated code in `./output/`.

---

## CRITICAL — 20 points each

Failing any Critical item is a blocking violation. A non-empty `critical_violations` array will fail the workflow regardless of total score.

### CRIT-1: as-associate Chain

- All cart writes (add line item, remove, update quantity, set address, set shipping method) use the full as-associate chain:
  `apiRoot.asAssociate().withAssociateIdValue({ associateId }).inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey }).*`
- All order creation uses the as-associate chain.
- All quote request and quote acceptance operations use the as-associate chain.
- Plain `apiRoot.carts()`, `apiRoot.orders()`, or `apiRoot.quoteRequests()` are NOT used for B2B operations.

**Pass condition:** No bare `apiRoot.carts().*` or `apiRoot.orders().*` calls exist in B2B cart/order/quote logic.

### CRIT-2: Session B2B Fields — Atomic Write

- After store selection or login with business unit context, the following session fields are written together in a single operation from `getStoreChannelData(storeKey)` (or equivalent):
  - `businessUnitKey`
  - `storeKey`
  - `distributionChannelId`
  - `supplyChannelId`
  - `productSelectionId`
- These fields are never written piecemeal across multiple session updates.

**Pass condition:** All five fields are populated together from a single `getStoreChannelData` / store-context lookup and written to session atomically.

### CRIT-3: Four-Field Locale Atomicity

- The four locale/currency fields — `locale`, `urlLocale`, `currency`, `country` — are always updated together in a single session write. No partial updates.
- When locale or currency changes, `cartId` is removed from the session (a cart scoped to the old currency must not be reused).

**Pass condition:** All locale switch logic updates all four fields atomically and clears `cartId`.

### CRIT-4: Session Passed to Product Queries

- `session` (containing `distributionChannelId`, `supplyChannelId`, `storeKey`) is always passed as a parameter to `searchProducts()` and `getProductBySku()` (or equivalents).
- These functions use the channel IDs to scope CT API requests so that channel-specific pricing is returned.
- Products are NEVER fetched without channel context in a B2B session.

**Pass condition:** `searchProducts()` and `getProductBySku()` accept and use session channel fields. No product fetch bypasses channel scoping.

### CRIT-5: CT Login Endpoint

- User login calls `apiRoot.login().post({ body: { ... } })`.
- The legacy `apiRoot.customers().login()` endpoint is NOT used anywhere.

**Pass condition:** `apiRoot.login().post()` is used; `apiRoot.customers().login()` does not appear.

### CRIT-6: lib/ct Is Server-Only

- `lib/ct/*` files are server-only (contain `import 'server-only'` or are exclusively used in Server Components / Route Handlers).
- No file that contains `'use client'` imports anything from `@/lib/ct`.
- Components import types from `@/lib/types` (not from CT SDK types or `lib/ct/*`).
- No `NEXT_PUBLIC_CTP` environment variables appear anywhere.

**Pass condition:** Zero client files import from `lib/ct/`. No `NEXT_PUBLIC_CTP*` vars present.

---

## HIGH — 10 points each

### HIGH-1: BU Key in SWR Cache Keys

- Dashboard data hooks (orders history, quotes list, approval flows, business unit details) use tuple cache keys that include `businessUnitKey`, e.g. `[KEY_ORDERS, businessUnitKey]`.
- Plain string keys (e.g. `KEY_ORDERS` alone) must not be used for data that is BU-scoped, as they would leak data between business units on BU switch.

**Pass condition:** At least three BU-scoped SWR hooks use tuple keys containing `businessUnitKey`.

### HIGH-2: Permission Gating

- All UI actions that require associate-level permissions (creating quotes, placing orders, managing approval rules, managing addresses) are gated with a `usePermissions()` hook or equivalent.
- Actions that the current associate cannot perform are hidden or disabled — not just server-rejected.

**Pass condition:** `usePermissions()` or equivalent is used in at least two distinct feature areas (e.g. checkout, quotes).

### HIGH-3: Parallel Fetching

- Independent server-side data fetches are made concurrently using `Promise.all([...])`.
- Examples: fetching BU details and cart simultaneously; fetching product and category context together.

**Pass condition:** At least two instances of `Promise.all` used for independent CT API calls in Server Components or Route Handlers.

### HIGH-4: CT Type Boundary in Mappers

- `lib/ct/` functions return mapped app types (from `lib/types.ts`), not raw CT SDK types.
- A `lib/mappers/` directory (or equivalent) exists with mapping functions that transform CT responses to app types before they leave `lib/ct/`.
- Components never receive raw `BusinessUnit`, `Cart`, `QuoteRequest` etc. from CT SDK directly.

**Pass condition:** `lib/mappers/` exists; `lib/ct/` functions return app types.

### HIGH-5: CartContext Auto-Creation

- The cart Route Handler (or CartContext) checks whether `session.cartId` is absent or the cart is expired.
- If no valid cart exists, it auto-creates a new cart using the as-associate chain, including BU key, store key, currency, and country from the session.
- Cart creation never succeeds without all four session fields being present.

**Pass condition:** Cart auto-creation logic includes `businessUnitKey`, `storeKey`, `currency`, and `country` from session.

---

## MEDIUM — 5 points each

### MED-1: No fetch() in Components

- Components never call `fetch('/api/*')` directly.
- All API calls from the client side are encapsulated in `hooks/*Api.ts` files (or equivalents), which are imported by hooks/contexts.

**Pass condition:** No `fetch('/api/` calls inside `app/` component files. All such calls are in `hooks/` or `lib/`.

### MED-2: Store Data Cache

- `lib/ct/stores.ts` (or equivalent) has a module-level `Map` (`storeDataCache`) that caches store channel data by store key.
- This avoids repeated CT API calls for store data that changes infrequently.

**Pass condition:** A module-level cache Map for store data exists in `lib/ct/stores.ts`.

### MED-3: Product Type Cache

- The facets/product-type module (`lib/ct/facets.ts` or equivalent) has a `_productTypesCache` variable with a TTL of approximately 60 seconds.
- Attribute labels are fetched once and served from cache within the TTL window.

**Pass condition:** `_productTypesCache` with a TTL exists in the facets or product-type module.

### MED-4: Approval Flow Graceful Degradation

- The `GET /api/approval-flows` Route Handler (or equivalent) catches CT 403 errors.
- On 403, it returns `{ results: [], total: 0 }` rather than propagating the error.
- This handles associates without approval-flow visibility permissions without crashing the UI.

**Pass condition:** Approval flow endpoint catches 403 and returns empty results gracefully.

### MED-5: Quote sellerComment Per Round

- When displaying seller comments on a quote, the code reads from `Quote.sellerComment`, not `StagedQuote.sellerComment`.
- `StagedQuote.sellerComment` is an in-progress remark; only the committed `Quote` record holds the per-round seller comment.

**Pass condition:** Quote display logic reads `Quote.sellerComment`, not `StagedQuote.sellerComment`.

---

## SMOKE — presence checks (pass/fail, no partial credit)

| ID | Check |
|---|---|
| SMOKE-1 | Login route exists with business unit selection step (e.g. `app/[locale]/login/page.tsx` and BU selection UI) |
| SMOKE-2 | Product listing route exists with channel-scoped pricing (route passes session channel fields to CT query) |
| SMOKE-3 | PDP route exists with variant selector |
| SMOKE-4 | Cart context exists with BU + store auto-creation logic |
| SMOKE-5 | Quotes list page exists (`app/[locale]/account/quotes/page.tsx` or equivalent) |
| SMOKE-6 | Approval rules or approval flows page exists |

---

## Scoring Reference

| Tier | Points each | Max contribution |
|---|---|---|
| CRITICAL (6 items) | 20 | 120 |
| HIGH (5 items) | 10 | 50 |
| MEDIUM (5 items) | 5 | 25 |
| SMOKE (6 items) | pass/fail | qualitative |
| **Total** | | **195** |

A passing score is considered 140+ with zero critical violations. The judge must still report all violations even on a passing score.

---

## Output Format

The judge must produce `judge-result.json` with this exact structure:

```json
{
  "score": 0,
  "critical_violations": [
    { "item": "CRIT-1", "evidence": "lib/ct/cart.ts calls apiRoot.carts().post() without asAssociate chain" }
  ],
  "high_violations": [
    { "item": "HIGH-1", "evidence": "useOrders hook uses KEY_ORDERS plain string, not [KEY_ORDERS, businessUnitKey]" }
  ],
  "medium_violations": [],
  "passed_checks": ["CRIT-2", "CRIT-3", "HIGH-3", "SMOKE-1"],
  "notes": "Strong as-associate coverage in cart and orders. Missing mapper layer. Approval flow error handling absent."
}
```

Do not include explanatory prose outside this JSON structure. Write ONLY `judge-result.json`.
