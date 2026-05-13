# Performance

**Impact: MEDIUM — Correct patterns are already enforced by the architecture (Server Components, BFF). Violations show up as waterfalls, N+1 queries, or unnecessary client re-fetches.**

This reference covers parallel data fetching, `unstable_cache` for stable data, SWR fallback injection from the server, image optimization, and the anti-patterns that crater TTFB.

## Table of Contents
- [Pattern 1: Parallel Fetching in Server Components](#pattern-1-parallel-fetching-in-server-components)
- [Pattern 2: unstable_cache for Stable CT Data](#pattern-2-unstable_cache-for-stable-ct-data)
- [Pattern 3: SWR Fallback Injection from the Server](#pattern-3-swr-fallback-injection-from-the-server)
- [Pattern 4: Image Optimization](#pattern-4-image-optimization)
- [Pattern 5: N+1 Anti-Patterns to Avoid](#pattern-5-n1-anti-patterns-to-avoid)
- [Checklist](#checklist)

---

## Pattern 1: Parallel Fetching in Server Components

**INCORRECT:** Awaiting independent fetches sequentially — this creates a waterfall where each request waits for the previous one:

```typescript
// WRONG — sequential waterfall
const session = await getSession();        // 50 ms
const locale = await getLocale();          // 50 ms
const categories = await getCategoryTree(locale); // 200 ms
// Total: 300 ms
```

**CORRECT — `Promise.all` for all independent fetches:**

```typescript
// CORRECT — parallel, total ≈ longest individual fetch
const [session, locale, messages, validCountryConfig] = await Promise.all([
  getSession(),
  getLocale(),
  getMessages(),
  getValidCountryConfig(), // cached with unstable_cache
]);
// Total: ~50 ms (session/locale win, messages/validation cached)
```

**Category page example** — category metadata and tree must be parallel:

```typescript
// app/[locale]/category/[slug]/page.tsx
const [category, categoryTree] = await Promise.all([
  getCategoryBySlug(slug, locale),
  getCategoryTree(locale),
]);
if (!category) notFound();

// Then build the breadcrumb by walking the in-memory tree — zero extra CT calls
const flat = categoryTree.flat();
let current = category;
while (current.parent) {
  const parent = flat.find((c) => c.id === current.parent?.id);
  if (parent) { breadcrumb.unshift({ name: parent.name, slug: parent.slug }); current = parent; }
  else break;
}
```

> **Rule:** If two fetches don't depend on each other's output, they must run in `Promise.all`. The most common violation is awaiting `getSession()` before calling `getLocale()` when neither needs the other.

---

## Pattern 2: unstable_cache for Stable CT Data

**INCORRECT:** Re-fetching the CT project configuration on every request — this data changes rarely and adds ~50 ms to every page render:

```typescript
// WRONG — fresh CT call on every render
export default async function RootLayout() {
  const { countries, currencies } = await apiRoot.get().execute(); // called every request
}
```

**CORRECT — `unstable_cache` with a TTL for data that rarely changes:**

```typescript
// lib/ct/locale-validation.ts
import { unstable_cache } from 'next/cache';
import { apiRoot } from './client';
import { COUNTRY_CONFIG } from '@/lib/utils';

async function fetchValidCountryConfig() {
  const res = await apiRoot.get().execute();
  const { countries = [], currencies = [], languages = [] } = res.body;

  return Object.fromEntries(
    Object.entries(COUNTRY_CONFIG).filter(([country, config]) => {
      const localeMatches = languages.some(
        (l: string) => l.toLowerCase() === config.locale.toLowerCase()
      );
      return countries.includes(country) && currencies.includes(config.currency) && localeMatches;
    })
  );
}

// Cached for 300 seconds (5 minutes) — survives across multiple requests
export const getValidCountryConfig = unstable_cache(
  fetchValidCountryConfig,
  ['locale-validation'],
  { revalidate: 300 }
);
```

**When to use `unstable_cache`:**

| Data | Cache TTL | Reason |
|------|-----------|--------|
| CT project config (countries, currencies) | 300 s | Changes only on project reconfiguration |
| Category tree | 60 s | Rarely edited; high reuse across pages |
| Shipping methods | 60 s | Rarely edited; no per-user variation |
| Product prices | **Do not cache** | Can change on promotion rules; per-currency |
| Cart data | **Do not cache** | Per-session, changes frequently |

> **Never cache per-user or per-session data with `unstable_cache`** — its cache is shared across all requests. Use SWR (client-side) or direct CT calls (server-side per-request) for user-specific data.

---

## Pattern 3: SWR Fallback Injection from the Server

**INCORRECT:** Letting SWR fetch the cart and account on initial page load — this causes a loading spinner flash on first render:

```typescript
// WRONG — SWR fetches from scratch on mount
export function CartProvider({ children }) {
  const { data: cart } = useCartSWR(); // triggers /api/cart on mount
  // ...
}
```

**CORRECT — inject server-fetched data into SWR's cache via `SWRConfig fallback`:**

```typescript
// app/layout.tsx (Server Component)
export default async function RootLayout({ children }) {
  const [session, messages, { locale }, validCountryConfig] = await Promise.all([
    getSession(),
    getMessages(),
    getLocale(),
    getValidCountryConfig(),
  ]);

  // Pre-fetch cart — if not Active, let SWR handle it client-side
  let initialCart = null;
  if (session.cartId) {
    try {
      const cart = await getCart(session.cartId);
      if (cart.cartState === 'Active') initialCart = cart;
    } catch {
      // stale cartId — SWR will clear it on first client fetch
    }
  }

  // Pre-populate user from session (no extra CT call needed)
  const initialUser = session.customerId
    ? {
        id: session.customerId,
        email: session.customerEmail || '',
        firstName: session.customerFirstName || '',
        lastName: session.customerLastName || '',
      }
    : null;

  return (
    <html lang="en">
      <body>
        <NextIntlClientProvider messages={messages}>
          {/* KEY_CART and KEY_ACCOUNT pre-filled — useCartSWR and useAccount skip
              their first fetch and render immediately with server data */}
          <SWRConfig value={{ fallback: { [KEY_CART]: initialCart, [KEY_ACCOUNT]: initialUser } }}>
            <LocaleProvider initialCountry={initialCountry} countryConfig={validCountryConfig}>
              <CartProvider>
                <Header />
                <main>{children}</main>
                <Footer />
              </CartProvider>
            </LocaleProvider>
          </SWRConfig>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

> **`SWRConfig fallback`** at the root layout level populates the SWR cache before any Client Component mounts. `useCartSWR()` and `useAccount()` see the pre-fetched data immediately — no loading state, no extra round-trip.

**Why build `initialUser` from the session instead of fetching from CT:**

The session JWT already carries `customerId`, `customerEmail`, `customerFirstName`, `customerLastName`. For the account avatar and navigation, this is sufficient. A full CT customer fetch is only needed on the account profile page where the user might update fields.

---

## Pattern 4: Image Optimization

**INCORRECT:** Using `<img>` tags with unoptimized external URLs — these are fetched raw, not resized, and block the LCP:

```tsx
// WRONG
<img src={imageUrl} alt={product.name} style={{ width: 400, height: 400 }} />
```

**CORRECT — `next/image` with explicit `width` + `height`, and `priority` on the LCP element:**

```tsx
import Image from 'next/image';

// Product card (listing page) — no priority, lazy-loaded
<Image
  src={imageUrl}
  alt={product.name}
  width={400}
  height={400}
  className="w-full h-full object-cover"
/>

// Main PDP image — LCP element, must preload
<Image
  src={images[activeIndex]}
  alt={productName}
  width={600}
  height={600}
  className="w-full h-full object-cover"
  priority  // ← only on the above-the-fold image
/>
```

`next.config.ts` — allow all HTTPS image domains (or lock down to specific hostnames):

```typescript
const nextConfig: NextConfig = {
  images: {
    unoptimized: true,  // external CDN handles optimization
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: '**' },
    ],
  },
};
```

> **`priority` on exactly one image per page** — the main PDP image or the hero banner. Using `priority` on multiple images defeats the optimization.

---

## Pattern 5: N+1 Anti-Patterns to Avoid

### Category breadcrumb — N+1 parent lookups

**INCORRECT:** Fetching each parent category one by one:

```typescript
// WRONG — O(depth) CT calls
let current = category;
while (current.parent) {
  current = await getCategoryById(current.parent.id, locale); // CT call per level
  breadcrumb.unshift(current);
}
```

**CORRECT — fetch the full tree once, walk it in memory:**

```typescript
// CORRECT — 1 CT call for the whole tree, O(n) in-memory walk
const [category, categoryTree] = await Promise.all([
  getCategoryBySlug(slug, locale),
  getCategoryTree(locale),        // fetches all categories (limit: 200)
]);

const flat = categoryTree.flat();
let current = category;
while (current.parent) {
  const parent = flat.find((c) => c.id === current.parent?.id);
  if (parent) { breadcrumb.unshift({ name: parent.name, slug: parent.slug }); current = parent; }
  else break;
}
```

### Product card prices — N+1 price fetches

**INCORRECT:** Fetching each variant's price separately after a product list query:

```typescript
// WRONG — 1 extra CT call per product
for (const product of products) {
  product.price = await getVariantPrice(product.id, currency, country);
}
```

**CORRECT — pass `priceCurrency` + `priceCountry` in the search query body:**

```typescript
// CORRECT — CT resolves prices in the same search response
const body: ProductSearchRequest = {
  productProjectionParameters: {
    priceCurrency: currency,
    priceCountry: country,
  },
  // ...
};
// Variants arrive with .price already set — no extra fetch
```

### Account page — serial user + orders fetch

**INCORRECT:** Awaiting user before fetching orders:

```typescript
// WRONG — sequential
const customer = await getCustomerById(session.customerId);
const orders = await getCustomerOrders(session.customerId);
```

**CORRECT — parallel, both need only `customerId` from session:**

```typescript
// CORRECT
const [customer, ordersResult] = await Promise.all([
  getCustomerById(session.customerId),
  getCustomerOrders(session.customerId, 5), // last 5 for the dashboard
]);
```

---

## Checklist

- [ ] All independent fetches in Server Components use `Promise.all`
- [ ] Stable CT data (category tree, shipping methods, project config) wrapped in `unstable_cache`
- [ ] `unstable_cache` is never used for per-user or per-session data
- [ ] `SWRConfig fallback` at root layout pre-populates `KEY_CART` and `KEY_ACCOUNT` from server
- [ ] `initialUser` is built from session fields — no extra `getCustomerById` call in layout
- [ ] PDP main image uses `priority` prop; product card images do not
- [ ] `next/image` is used for all product images
- [ ] Category breadcrumb walks the in-memory tree — not individual `getCategoryById` calls
- [ ] Product search passes `priceCurrency`/`priceCountry` — no post-query price fetches
