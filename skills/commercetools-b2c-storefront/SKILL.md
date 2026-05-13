---
name: commercetools-b2c-storefront
description: Production-tested patterns for building a B2C storefront on commercetools with Next.js 14 App Router, TypeScript, Tailwind v4, and JWT sessions — from green-field scaffold to production deployment.
---

# Next.js + commercetools B2C Storefront

Production-tested patterns for building a B2C storefront on commercetools with Next.js 14 App Router, TypeScript, Tailwind v4, and JWT sessions. Derived from the b2c-starter-kit — a working production storefront.

## Key Takeaways

**The BFF pattern is non-negotiable.** All commercetools API calls go through Next.js Route Handlers (`app/api/`). The browser never calls CT directly. Secrets never get a `NEXT_PUBLIC_` prefix.

**Sessions are JWT cookies, not server-side stores.** The `vibe-session` HTTP-only cookie carries `customerId`, `cartId`, and locale. Every API route reads it with `getSession()` and re-writes it with `setSessionCookie()`.

**Server Components for catalog data, SWR hooks for mutable user state.** Category pages and PDPs are async Server Components that call `lib/ct/*` directly. Cart, account, and wishlist use SWR hooks → Route Handlers → CT SDK.

**CT optimistic concurrency requires retry logic.** Every cart update needs the current cart `version`. Simultaneous requests cause 409 conflicts — the cart API routes retry up to 3 times with a fresh version fetch each time.

**Locales use lowercase-hyphen format in URLs.** `en-us`, `de-de` — not `en-US`. next-intl routes under `/en-us/`, `/de-de/`, etc. The `vibe-country` cookie drives which locale the middleware redirects to.

---

## Reference Index

### Core — Green-Field Build (follow in order)

| Task | Reference |
|------|-----------|
| Scaffold the app, Tailwind v4, next-intl routing, middleware | [project-setup.md](./references/project-setup.md) |
| CT SDK singleton, JWT sessions, BFF architecture | [ct-client.md](./references/ct-client.md) |
| Category pages, product mapper, CT Search API v2, ProductCard/Grid | [product-listing.md](./references/product-listing.md) |
| PDP route, image gallery, variant selectors, AddToCartButton | [product-detail.md](./references/product-detail.md) |
| Cart CRUD, CartContext, SWR hook, mini-cart drawer | [cart.md](./references/cart.md) |
| Shipping methods, order placement, multi-step checkout, confirmation | [checkout.md](./references/checkout.md) |
| Register, login, anonymous cart merge, protected account layout | [customer-auth.md](./references/customer-auth.md) |
| Full-text search, facet config, URL state, renderers | [search-facets.md](./references/search-facets.md) |
| Parallel fetching, `unstable_cache`, SWR prefetch, image optimization | [performance.md](./references/performance.md) |

### Enhancement — Modify Existing Features

| Task | Reference |
|------|-----------|
| Add a new BFF endpoint + SWR hook (the 3-layer pattern) | [add-api.md](./references/add-api.md) |
| Add a new standalone or CMS-driven page | [add-page.md](./references/add-page.md) |
| Add a new section/banner/block to any page | [add-homepage-element.md](./references/add-homepage-element.md) |
| Use or extend the shared UI component library | [ui-components.md](./references/ui-components.md) |
| Server vs SWR decisions, mappers, BFF shape, 409 retry | [data-loading.md](./references/data-loading.md) |
| Add a new country / currency / locale | [add-country.md](./references/add-country.md) |
| Configure PDP variant selectors (blocklist, swatch, sort order) | [variant-config.md](./references/variant-config.md) |
| Configure product image URL transforms (CDN, Imgix, Cloudinary) | [image-config.md](./references/image-config.md) |
| Deploy to Netlify | [netlify.md](./references/netlify.md) |

### Optional Features — Not Required for Core Storefront
Ask user if they want to implement these features after completing the core build.

| Task | Reference |
|------|-----------|
| CSR impersonation, dual session, line-item price override | [superuser.md](./references/superuser.md) |
| Buy Online Pick Up In Store — channel API, per-store inventory | [bopis.md](./references/bopis.md) |
| Product bundles — parent/child cart items, cascade updates | [bundles.md](./references/bundles.md) |
| Product discounts, cart discounts, discount codes, promotion banners | [promotions.md](./references/promotions.md) |

---

## Priority Tiers

### CRITICAL

- **BFF architecture** — `lib/ct/*` is server-only. Zero CT imports in any `'use client'` file.
- **Cart versioning** — Always re-fetch cart before writing; retry on 409 ConcurrentModification.
- **Session secrets** — `SESSION_SECRET` and `CTP_CLIENT_SECRET` are env vars, never hardcoded or `NEXT_PUBLIC_`.
- **CT login endpoint** — Use `apiRoot.login().post()`, not `apiRoot.customers().login()`.
- **Cart creation** — Always include `shippingMode: 'Single'`.

### HIGH

- **Parallel fetching** — `Promise.all` for independent fetches in Server Components. No request waterfalls.
- **Type safety** — Frontend components import types from `lib/types.ts`, never from `lib/ct/*`.
- **Anonymous cart merge** — Pass `anonymousCartId` to CT login so the cart is preserved on sign-in.
- **SWR cache invalidation** — Mutate `KEY_CART` and `KEY_ACCOUNT` after login/logout/order placement.
- **CT type boundary** — Map CT SDK responses to app types in `lib/mappers/` before they leave `lib/ct/`.

### MEDIUM

- **Product Search API** — Use `/products/search` (CT v2), not legacy product projections search.
- **`unstable_cache`** — Wrap rarely-changing CT data (category tree, attribute labels) with a TTL.
- **Cart state cleared after order** — Remove `cartId` from session after `createOrderFromCart`.
- **Locale format duality** — URL segments: `en-us`. CT API calls: `en-US`. Keep `COUNTRY_CONFIG` as the single mapping.

---

## Anti-Patterns Quick Reference

| Anti-pattern | Correct approach |
|---|---|
| `import { apiRoot } from '@/lib/ct/client'` in a `'use client'` file | Use a SWR hook → Route Handler → `lib/ct/` |
| `fetch('/api/*')` directly in a component | Encapsulate in a hook in `site/hooks/` |
| `new ClientBuilder()` inside a page or Route Handler | Singleton `apiRoot` in `lib/ct/client.ts` |
| `NEXT_PUBLIC_CTP_CLIENT_SECRET=...` | Server-only env var, no `NEXT_PUBLIC_` prefix |
| `product.name['en-US']` (hardcoded locale key) | `getLocalizedString(product.name, locale)` |
| `(centAmount / 100).toFixed(2)` | `formatMoney(centAmount, currencyCode, locale)` |
| Sequential `await` for independent fetches | `Promise.all([fetchA(), fetchB()])` |
| `apiRoot.customers().login()` | `apiRoot.login().post()` |
| Cart update without `version` | Fetch cart first, use `cart.version`, retry on 409 |
| `import Link from 'next/link'` in a page component | `import { Link } from '@/i18n/routing'` |
| Per-user data in `unstable_cache` | SWR hook (client) or direct CT call (per-request server) |
| CT types in components | Types from `lib/types.ts`; mapped in `lib/mappers/` |
