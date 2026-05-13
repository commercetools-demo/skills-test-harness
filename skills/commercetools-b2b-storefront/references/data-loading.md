# Data Loading

**Impact: HIGH — `lib/ct/` is server-only. Importing it in a `'use client'` file exposes secrets. CT responses must be mapped to app types before leaving `lib/ct/`.**

This reference covers when to use Server Components vs SWR hooks, mappers, the CT type boundary, parallel fetching, and the version-conflict retry pattern.

## Table of Contents
- [Pattern 1: Data Flow Rule](#pattern-1-data-flow-rule)
- [Pattern 2: Server Components for Initial Page Data](#pattern-2-server-components-for-initial-page-data)
- [Pattern 3: SWR Hooks for User-Specific / Interactive Data](#pattern-3-swr-hooks-for-user-specific--interactive-data)
- [Pattern 4: Mappers — CT Type Boundary](#pattern-4-mappers--ct-type-boundary)
- [Pattern 5: Parallel Fetching](#pattern-5-parallel-fetching)
- [Pattern 6: Version-Conflict Retry for Cart](#pattern-6-version-conflict-retry-for-cart)
- [Pattern 7: Server-Side Caching](#pattern-7-server-side-caching)
- [Checklist](#checklist)

---

## Pattern 1: Data Flow Rule

**INCORRECT:** Importing `lib/ct/` from a client file:

```typescript
// WRONG — exposes CT secrets to the browser bundle
'use client';
import { searchProducts } from '@/lib/ct/products';
// WRONG — direct fetch in a component
const res = await fetch('/api/orders');
```

**CORRECT — strict one-way data flow:**

```
Server Component (page.tsx)
  └─ lib/ct/<namespace>.ts → CT SDK → CT API

Client Component
  └─ hook (hooks/*Api.ts) → fetch('/api/…') → Route Handler (app/api/*)
       └─ lib/ct/<namespace>.ts → CT SDK → CT API
```

Never import from `lib/ct/` in a `'use client'` file. For types, import from `@/lib/types`.

---

## Pattern 2: Server Components for Initial Page Data

```typescript
// app/[locale]/category/[slug]/page.tsx
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;  // Always await params in Next.js 15+
  const session = await getSession();

  const [category, products] = await Promise.all([
    getCategoryBySlug(slug, undefined, session),
    searchProducts({ categorySlug: slug, limit: 24 }, session),
  ]);

  if (!category) notFound();
  return <CategoryView category={category} initialProducts={products} />;
}
```

Rules:
- All page components are `async` by default — no `'use client'` unless the page needs browser APIs
- Always `await params` — it's a Promise in Next.js 15+
- Call `notFound()` for missing required resources
- Pass `session` to CT functions rather than calling `getSession()` inside each function

---

## Pattern 3: SWR Hooks for User-Specific / Interactive Data

```typescript
// hooks/useOrders.ts
'use client';
import useSWR from 'swr';
import { KEY_ORDERS } from '@/lib/cache-keys';

async function ordersFetcher([, buKey]: [string, string]) {
  const res = await fetch(`/api/orders?buKey=${buKey}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.orders ?? [];
}

export function useOrders() {
  const { currentBusinessUnit } = useBusinessUnit();
  const buKey = currentBusinessUnit?.key ?? null;
  return useSWR<Order[]>(
    buKey ? [KEY_ORDERS, buKey] : null,
    ordersFetcher,
    { revalidateOnFocus: false }
  );
}
```

Rules:
- BU-scoped data always uses `[KEY, buKey]` tuple — `null` when buKey not available
- Read hooks return safe defaults (`[]`, `null`) on `!res.ok` — never throw
- Mutations throw on error — the component handles it with `try/catch`
- `revalidateOnFocus: false` for all hooks — storefront doesn't need live refetch on tab switch

---

## Pattern 4: Mappers — CT Type Boundary

**INCORRECT:** Passing CT SDK types to components:

```typescript
// WRONG — CT SDK type reaches the component; mappers should have been called earlier
export async function getOrders(customerId: string): Promise<Order[]> {
  const { body } = await apiRoot.orders().get(...).execute();
  return body.results; // Order[] from CT SDK — not app types
}
```

**CORRECT — map CT responses before returning from `lib/ct/`:**

```typescript
// lib/ct/orders.ts
import { mapOrder } from '@/lib/mappers/order';

export async function getOrders(associateId: string, businessUnitKey: string): Promise<Order[]> {
  const { body } = await apiRoot
    .asAssociate()
    .withAssociateIdValue({ associateId })
    .inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey })
    .orders()
    .get({ queryArgs: { sort: 'createdAt desc', limit: 20 } })
    .execute();
  return body.results.map(mapOrder); // App type — safe to pass to components
}
```

**Mapper files:**

| File | Maps |
|---|---|
| `lib/mappers/product.ts` | `ProductProjection` → `Product` |
| `lib/mappers/category.ts` | CT `Category` → app `Category` |
| `lib/mappers/order.ts` | CT `Order` → app `Order` |
| `lib/mappers/quote.ts` | CT `Quote` → app `Quote` |
| `lib/mappers/business-unit.ts` | CT `BusinessUnit` → app `BusinessUnit` |
| `lib/mappers/approval-flow.ts` | CT `ApprovalFlow` → app `ApprovalFlow` |
| `lib/mappers/line-item.ts` | CT `LineItem` → app `LineItem` |
| `lib/mappers/customer.ts` | CT `Customer` → app `Account` |
| `lib/mappers/associate-role.ts` | CT `AssociateRole` → app `AssociateRole` |
| `lib/mappers/money.ts` | CT `TypedMoney` → app `Money` |
| `lib/mappers/facet.ts` | CT facet results → `FacetResult[]` |

**Localization in mappers:**

```typescript
// lib/mappers/product.ts
import { getLocalizedString } from '@/lib/utils';

export function mapProduct(projection: ProductProjection, locale: string): Product {
  return {
    name: getLocalizedString(projection.name, locale),   // plain string
    description: getLocalizedString(projection.description, locale),
    // ...
  };
}
```

`getLocalizedString` falls back: requested locale → default locale → first available → `''`. Never call it outside `lib/ct/` or `lib/mappers/`.

---

## Pattern 5: Parallel Fetching

```typescript
// ✅ correct — both requests run concurrently
const [category, products] = await Promise.all([
  getCategoryBySlug(slug, undefined, session),
  searchProducts({ categorySlug: slug }, session),
]);

// ❌ wrong — products wait for category to finish
const category = await getCategoryBySlug(slug, undefined, session);
const products = await searchProducts({ categorySlug: slug }, session);
```

Only use sequential `await` when the second call depends on data from the first.

---

## Pattern 6: Version-Conflict Retry for Cart

CT cart operations use optimistic locking — every mutation needs the current version. Use the as-associate chain with a read-then-write for sensitive operations:

```typescript
// lib/ct/cart.ts — update cart with version validation
export async function updateCart(
  cartId: string, version: number, actions: CartUpdateAction[],
  associateId: string, businessUnitKey: string, _storeKey: string, locale?: string
): Promise<Cart> {
  try {
    const { body } = await asAssociateInStore(associateId, businessUnitKey)
      .withId({ ID: cartId })
      .post({ body: { version, actions } })
      .execute();
    return mapCart(body, locale);
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 409) {
      // Version conflict — re-fetch and retry once
      const fresh = await getCartById(cartId, associateId, businessUnitKey, _storeKey, locale);
      const { body } = await asAssociateInStore(associateId, businessUnitKey)
        .withId({ ID: cartId })
        .post({ body: { version: fresh.version, actions } })
        .execute();
      return mapCart(body, locale);
    }
    throw error;
  }
}
```

---

## Pattern 7: Server-Side Caching

| Cache | File | TTL | Notes |
|---|---|---|---|
| Store data | `lib/ct/stores.ts` `storeDataCache` | No expiry | Module-level `Map`; reset on server restart |
| Product types | `lib/ct/facets.ts` `_productTypesCache` | 60 seconds | Only timed cache in the codebase |
| Locale config | `lib/ct/locale-validation.ts` | 5 min via `unstable_cache` | Validates countries/currencies against CT project |
| Associate roles | `hooks/usePermissions.ts` | Tab lifetime | Module-level variable; reset on error |

> **Never use `unstable_cache` for per-user or per-BU data** — it is shared across all requests.

---

## Checklist

- [ ] `lib/ct/` never imported in `'use client'` files — import types from `@/lib/types`
- [ ] CT responses mapped to app types inside `lib/ct/<namespace>.ts` via mappers
- [ ] All independent server-side fetches use `Promise.all`
- [ ] SWR hooks use `[KEY, businessUnitKey]` tuple for BU-scoped data
- [ ] Read hooks return safe defaults; mutations throw on error
- [ ] `getLocalizedString` called only in `lib/ct/` or `lib/mappers/`
- [ ] Cart version conflict retried on 409
- [ ] `fetch('/api/*')` calls live in `hooks/*Api.ts`, not in component or context files
