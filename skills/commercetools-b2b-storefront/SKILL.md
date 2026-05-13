---
name: commercetools-b2b-storefront
description: Production-tested patterns for building a B2B storefront on commercetools with Next.js App Router, TypeScript, Tailwind v4, and JWT sessions — business units, stores, channel-scoped pricing, permissions, quotes, and approval workflows.
---

# Next.js + commercetools B2B Storefront

Production-tested patterns for the b2b-site — a B2B ecommerce storefront built on commercetools with Next.js App Router, TypeScript, Tailwind CSS, and JWT sessions. The key B2B concepts are: associates acting on behalf of business units, store-scoped pricing/inventory, associate permissions enforced by CT, and B2B-only features (quotes, approval workflows, purchase lists, recurring orders).

## Key Takeaways

**Every B2B operation uses the as-associate API chain.** Cart reads, cart writes, orders, quotes, approval flows — all go through `apiRoot.asAssociate().withAssociateIdValue({ associateId }).inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey }).*`. The `associateId` is always `session.customerId`; the `businessUnitKey` is always `session.businessUnitKey`. CT enforces associate permissions server-side — no app-level permission checks in Route Handlers.

**Session carries five B2B-specific fields.** `businessUnitKey`, `storeKey`, `distributionChannelId`, `supplyChannelId`, and `productSelectionId` are resolved once (at login or BU selection) from the store record and written atomically into the JWT cookie. Every product search and cart operation reads these from the session.

**Prices and availability are session-scoped, not global.** `ProductApi.buildProjectionParams()` injects `priceChannel` (distributionChannelId), `storeProjection` (storeKey), and `priceCustomerGroupAssignments` (accountGroupIds) into every search. Without a store context (unauthenticated users), CT returns "Price on request."

**Locale uses four fields that must always be written together.** `locale` (CT backend BCP-47, e.g. `de-DE`), `urlLocale` (URL key, e.g. `de-ch`), `currency`, and `country`. Never update one without the others. Changing locale or currency clears `cartId` — CT cart currency is immutable.

**Permission enforcement is dual-layer.** The UI uses `usePermissions()` to hide/disable buttons. The API enforces everything automatically via the as-associate chain — a 403 from CT means the associate lacks the permission. No app-level authorization code in Route Handlers.

---

## Reference Index

### Core — B2B Foundation (follow in order)

| Task | Reference |
|------|-----------|
| Project structure, LOCALE_CONFIG, session cookie, CT client singleton | [project-setup.md](./references/project-setup.md) |
| Session fields, BU/store selection, channel data, BusinessUnitContext | [session-and-bu.md](./references/session-and-bu.md) |
| ProductApi session scoping — store, channels, price injection, availability | [product-listing.md](./references/product-listing.md) |
| PDP route, variant selectors, session-scoped PDP pricing | [product-detail.md](./references/product-detail.md) |
| as-associate cart CRUD, CartContext, auto-creation with BU+store | [cart.md](./references/cart.md) |
| Order placement from cart and from quote, confirmation | [checkout.md](./references/checkout.md) |
| Login endpoint, BU auto-select, session fields written at login | [customer-auth.md](./references/customer-auth.md) |
| RBAC — all permission strings, usePermissions, UI gating patterns | [permissions.md](./references/permissions.md) |

### B2B Feature Modules

| Task | Reference |
|------|-----------|
| Quote lifecycle, multi-round negotiation, CT data model, SWR hooks | [quotes.md](./references/quotes.md) |
| Approval rules, approval flows, predicate builder, tier model | [approval-workflows.md](./references/approval-workflows.md) |
| Dashboard shell, stat widgets, pages, sidebar nav items | [dashboard.md](./references/dashboard.md) |
| Recurring orders — pause, resume, cancel, duplicate | [recurring-orders.md](./references/recurring-orders.md) |
| Purchase lists (CT ShoppingList via as-associate, BU-scoped) | [purchase-lists.md](./references/purchase-lists.md) |

### Enhancement — Modify Existing Features

| Task | Reference |
|------|-----------|
| Add a new BFF endpoint + SWR hook (no-fetch-in-client, 3-layer pattern) | [add-api.md](./references/add-api.md) |
| Server vs SWR decisions, mappers, BFF shape, CT type boundary | [data-loading.md](./references/data-loading.md) |
| Four-field locale atomicity, locale vs urlLocale, CT validation | [locale-session.md](./references/locale-session.md) |
| Add a new country / currency / locale | [add-country.md](./references/add-country.md) |
| Facet config, FACET_BLOCKLIST, FACET_RENDERER_MAP, URL params | [facet-filters.md](./references/facet-filters.md) |
| Add a new page — standalone or dashboard section | [add-page.md](./references/add-page.md) |
| Add a new element to any page using the layout/sections system | [add-homepage-element.md](./references/add-homepage-element.md) |
| Configure PDP variant selectors (blocklist, swatch, sort order) | [variant-config.md](./references/variant-config.md) |
| Deploy to Netlify | [netlify.md](./references/netlify.md) |

### Optional Features — Not Required for Core B2B Storefront

| Task | Reference |
|------|-----------|
| Superuser role — view all store carts, switch carts, merchant-origin carts | [superuser.md](./references/superuser.md) |
| Personal wishlists (project-level, not as-associate) | [wishlists.md](./references/wishlists.md) |

---

## Priority Tiers

### CRITICAL

- **as-associate chain** — ALL B2B writes (cart, order, quote, approval, BU) go through `apiRoot.asAssociate().*`. Never use project-level `apiRoot.*` for user-facing mutations.
- **Session B2B fields** — `businessUnitKey` + `storeKey` + `distributionChannelId` + `supplyChannelId` + `productSelectionId` are always written together from `getStoreChannelData(storeKey)`.
- **Four-field locale atomicity** — `locale`, `urlLocale`, `currency`, `country` must all be updated together. Reset `cartId` on locale/currency change.
- **Session fields for product pricing** — always pass `session` to `searchProducts()` and `getProductBySku()`. Without `distributionChannelId` and `storeKey`, CT returns unscoped "Price on request" prices.
- **CT login endpoint** — use `apiRoot.login().post()`, not `apiRoot.customers().login()`.
- **lib/ct is server-only** — never import from a `'use client'` file. Import types from `@/lib/types`.

### HIGH

- **BU key in SWR cache keys** — all dashboard hooks use `[KEY, businessUnitKey]` tuple keys so the cache auto-invalidates on BU switch.
- **Permission gating** — gate all UI actions with `usePermissions()`. CT enforces on the API side; the UI must not show what CT will reject.
- **Parallel fetching** — `Promise.all` for all independent server-side fetches. Sequential `await` is a performance bug.
- **Mappers** — CT SDK responses are mapped to app types in `lib/mappers/` before leaving `lib/ct/`. Components never receive CT SDK types.
- **CartContext auto-creation** — if `session.cartId` is absent when adding an item, the Route Handler creates a cart with `businessUnit` + `store` + `currency` + `country` from the session.

### MEDIUM

- **No-fetch-in-client** — all `fetch('/api/*')` calls live in `hooks/*Api.ts` functions, not in component or context files.
- **Store data cache** — `storeDataCache` in `lib/ct/stores.ts` is a module-level `Map` with no TTL. It is the single source for `storeId`, `distributionChannelId`, `supplyChannelId`, `productSelectionId`.
- **Product type cache** — `_productTypesCache` in `facets.ts` has a 60-second TTL (the only timed cache in the codebase).
- **Approval flow graceful degradation** — `GET /api/approval-flows` returns `{ results: [], total: 0 }` on CT 403, never a 4xx to the browser.
- **Quote `sellerComment` is per-round** — read from `Quote.sellerComment` (snapshot), not from `StagedQuote.sellerComment` (mutable latest).

---

## Anti-Patterns Quick Reference

| Anti-pattern | Correct approach |
|---|---|
| `apiRoot.carts().post(...)` for a logged-in user | `asAssociate().withAssociateIdValue(...).inBusinessUnitKey(...).carts().post(...)` |
| `fetch('/api/*')` inside a Context provider or component | Extract to `hooks/use<Resource>Api.ts` function |
| `import { apiRoot } from '@/lib/ct/client'` in `'use client'` file | Use a SWR hook → Route Handler → `lib/ct/` |
| `session.locale` used as URL locale | `session.urlLocale` for routing; `session.locale` for CT API calls |
| Setting `locale` without resetting `currency`, `country`, `cartId` | Update all four fields atomically via `POST /api/session/locale` |
| `product.name['en-US']` hardcoded | `getLocalizedString(product.name, session.locale)` |
| Omitting `distributionChannelId` in product search | Pass full session to `searchProducts()` — `ProductApi` injects channel automatically |
| `useSWR(KEY_ORDERS, ...)` without BU key | `useSWR([KEY_ORDERS, businessUnitKey], ...)` — cache must scope to the active BU |
| Reading approval flow version from client state | `fetchApprovalFlowRaw()` to get current version before every approve/reject |
| `StagedQuote.sellerComment` for per-round display | `Quote.sellerComment` — the snapshot at quote creation time |
| `apiRoot.shoppingLists()` for purchase lists | `asAssociate().*.shoppingLists()` — BU-scoped, permission-enforced |
