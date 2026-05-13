# Data Loading

**Impact: HIGH — Calling CT from a Client Component or importing `lib/ct/*` in a hook are the most common violations. CT types must never reach a component — map them at the CT layer.**

This file focuses on the mapper pattern, CT type boundary, and retry loop. See `performance.md` for parallel fetching and `add-api.md` for BFF route structure.

## Table of Contents
- [Pattern 1: Server vs SWR Decision](#pattern-1-server-vs-swr-decision)
- [Pattern 2: CT Type Boundary](#pattern-2-ct-type-boundary)
- [Pattern 3: BFF API Route Shape](#pattern-3-bff-api-route-shape)
- [Pattern 4: Version Conflict Retry](#pattern-4-version-conflict-retry)
- [Pattern 5: In-Memory TTL Cache](#pattern-5-in-memory-ttl-cache)

---

## Pattern 1: Server vs SWR Decision

**INCORRECT:** using SWR for initial page data — causes spinner on first load and unnecessary hydration delay.

```typescript
// BAD — Client Component with SWR for first-paint product data
'use client';
import useSWR from 'swr';

export default function ProductGrid({ categoryId }: { categoryId: string }) {
  const { data: products, isLoading } = useSWR(`/api/products?category=${categoryId}`, fetcher);
  if (isLoading) return <Spinner />;
  return <Grid products={products} />;
}
```

**CORRECT — async Server Component for first-paint data, SWR only for post-interaction data:**

```typescript
// GOOD — Server Component, no spinner, no hydration
// site/app/[locale]/category/[slug]/page.tsx
import { getProductsByCategory } from '@/lib/ct/products';

export default async function CategoryPage({ params }: { params: { slug: string } }) {
  const products = await getProductsByCategory(params.slug);
  return <ProductGrid products={products} />;
}
```

Decision table:

| Data | Pattern | Reason |
|---|---|---|
| Initial product list | Server Component | First paint, SEO, no spinner |
| Category tree | Server Component + TTL cache | Stable, needs SSR |
| Cart | SWR (`useCart`) | Changes after add/remove actions |
| Account / orders | SWR | Changes after login |
| Search results | Server Component (via URL params) | SEO, shareable URLs |

---

## Pattern 2: CT Type Boundary

**INCORRECT:** importing CT SDK types in components — leaks CT types into the UI layer.

```typescript
// BAD — CT type in a component
import type { ProductProjection } from '@commercetools/platform-sdk';

export default function ProductCard({ product }: { product: ProductProjection }) {
  // component must deal with LocalizedString, not plain string
  const name = product.name['en-US'];
}
```

**CORRECT — mappers in `lib/mappers/` convert CT types to app types before leaving `lib/ct/`:**

```typescript
// site/lib/mappers/product-mapper.ts
import type { ProductProjection } from '@commercetools/platform-sdk';
import type { Product } from '@/types';
import { getLocalizedString } from '@/lib/utils';

export function mapProduct(ct: ProductProjection, locale: string): Product {
  const variant = ct.masterVariant;
  return {
    id:          ct.id,
    slug:        getLocalizedString(ct.slug, locale),
    name:        getLocalizedString(ct.name, locale),     // LocalizedString → string
    description: getLocalizedString(ct.description, locale),
    price:       mapPrice(variant.price),
    imageUrl:    variant.images?.[0]?.url ?? '',
    attributes:  mapAttributes(variant.attributes ?? []),
  };
}
```

```typescript
// site/lib/ct/products.ts
import { mapProduct } from '@/lib/mappers/product-mapper';

export async function getProductsByCategory(slug: string, locale: string): Promise<Product[]> {
  const { body } = await ctClient.productProjectionsSearch().post({ ... }).execute();
  return body.results.map((ct) => mapProduct(ct, locale));  // CT types stop here
}
```

```typescript
// site/components/product/ProductCard.tsx  — only sees app types
import type { Product } from '@/types';  // never from @commercetools/platform-sdk

export default function ProductCard({ product }: { product: Product }) {
  return <h2>{product.name}</h2>;  // plain string, no locale lookup needed
}
```

> `getLocalizedString(field, locale)` handles `LocalizedString | undefined` safely and falls back to `'en-US'` if the requested locale is absent.

---

## Pattern 3: BFF API Route Shape

Route handlers have exactly 3 responsibilities. Never put raw SDK calls in a route handler.

```typescript
// site/app/api/cart/items/route.ts
import { readSession } from '@/lib/session';
import { addLineItem } from '@/lib/ct/cart';    // lib/ct/ — not the CT SDK directly
import { mapCart } from '@/lib/mappers/cart-mapper';

export async function POST(request: Request) {
  // 1. Validate session
  const session = await readSession(request);
  if (!session?.cartId) {
    return NextResponse.json({ error: 'No active cart' }, { status: 400 });
  }

  // 2. Call lib/ct/<namespace>.ts — never the CT SDK directly
  const { sku, quantity } = await request.json();
  const updatedCart = await addLineItem(session.cartId, session.customerId, sku, quantity);

  // 3. Return JSON with correct status
  return NextResponse.json(mapCart(updatedCart));
}
```

---

## Pattern 4: Version Conflict Retry

**INCORRECT:** calling CT update directly — fails on concurrent requests with 409 Conflict.

```typescript
// BAD — version may be stale
await ctClient.carts().withId({ ID: cartId })
  .post({ body: { version, actions } })
  .execute();
```

**CORRECT — `applyCartAction` re-fetches version and retries up to 3 times on 409:**

```typescript
// site/lib/ct/cart.ts
export async function applyCartAction(
  cartId: string,
  customerId: string | undefined,
  actions: CartUpdateAction[]
): Promise<Cart> {
  let attempts = 0;

  while (attempts < 3) {
    attempts++;
    try {
      // Always fetch fresh version before each attempt
      const { body: current } = await ctClient.carts().withId({ ID: cartId }).get().execute();
      const { body: updated } = await ctClient
        .carts()
        .withId({ ID: cartId })
        .post({ body: { version: current.version, actions } })
        .execute();
      return updated;
    } catch (err: any) {
      if (err?.statusCode === 409 && attempts < 3) continue;  // retry on version conflict
      throw err;
    }
  }
  throw new Error('Failed to apply cart action after 3 attempts');
}
```

Every cart mutation in `lib/ct/cart.ts` goes through `applyCartAction`. Never call the CT cart update endpoint directly.

---

## Pattern 5: In-Memory TTL Cache

For stable, rarely-changing data like the category tree. **Never cache per-user data this way.**

```typescript
// site/lib/ct/categories.ts
interface CacheEntry<T> { data: T; expiresAt: number }

let categoryCache: CacheEntry<Category[]> | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

export async function getCategoryTree(locale: string): Promise<Category[]> {
  const now = Date.now();

  if (categoryCache && categoryCache.expiresAt > now) {
    return categoryCache.data;
  }

  const { body } = await ctClient.categories().get({ queryArgs: { limit: 500 } }).execute();
  const categories = body.results.map((ct) => mapCategory(ct, locale));

  categoryCache = { data: categories, expiresAt: now + CACHE_TTL_MS };
  return categories;
}
```

> This cache is in-memory per serverless instance. It is appropriate for public data (categories, channels) that all users share. Never store session data, cart data, or anything customer-specific here.

---

## Checklist
- [ ] Server Components used for first-paint data (product lists, categories, PDP)
- [ ] SWR used only for post-interaction data (cart, account, orders)
- [ ] CT responses mapped to app types in `lib/mappers/` before leaving `lib/ct/`
- [ ] Localized fields (`LocalizedString`) resolved in mapper via `getLocalizedString(field, locale)`
- [ ] Components import from `@/types` — never from `@commercetools/platform-sdk`
- [ ] All cart mutations go through `applyCartAction` (handles 409 retry)
- [ ] API routes have exactly 3 responsibilities: validate session, call `lib/ct/`, return JSON
- [ ] No CT SDK calls in Route Handlers — always delegate to `lib/ct/<namespace>.ts`
- [ ] TTL cache only used for public, non-user-specific data
