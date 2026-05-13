# Product Listing

**Impact: HIGH — N+1 queries in category pages multiply CT API calls linearly with page size and crater TTFB.**

This reference covers category data fetching, the CT Product Search API, the product mapper, ProductCard/Grid components, and the Server Component category page.

## Table of Contents
- [Pattern 1: Category Helper Functions](#pattern-1-category-helper-functions)
- [Pattern 2: Product Mapper](#pattern-2-product-mapper)
- [Pattern 3: Product Search API](#pattern-3-product-search-api)
- [Pattern 4: Product UI Components](#pattern-4-product-ui-components)
- [Pattern 5: Category Page (Server Component)](#pattern-5-category-page-server-component)
- [Checklist](#checklist)

---

## Pattern 1: Category Helper Functions

`lib/ct/categories.ts`:

```typescript
import { apiRoot } from './client';
import { getLocalizedString } from '@/lib/utils';
import type { Category as CtCategory } from '@commercetools/platform-sdk';
import type { Category } from '@/lib/types';

function mapCategory(c: CtCategory, locale: string): Category {
  return {
    type: 'Category',
    id: c.id,
    images: (c.assets ?? []).map((a) => a.sources[0]?.uri ?? '').filter(Boolean),
    name: getLocalizedString(c.name as Record<string, string>, locale),
    slug: getLocalizedString(c.slug as Record<string, string>, locale),
    description: getLocalizedString(c.description as Record<string, string> | undefined, locale) || undefined,
    parent: c.parent ? { typeId: 'category', id: c.parent.id } : undefined,
  };
}

export async function getCategoryBySlug(slug: string, locale: string): Promise<Category | null> {
  try {
    const { body } = await apiRoot
      .categories()
      .get({ queryArgs: { where: `slug(${locale}="${slug}")`, limit: 1 } })
      .execute();
    return body.results[0] ? mapCategory(body.results[0], locale) : null;
  } catch {
    return null;
  }
}

export async function getCategoryById(id: string, locale: string): Promise<Category | null> {
  try {
    const { body } = await apiRoot.categories().withId({ ID: id }).get().execute();
    return mapCategory(body, locale);
  } catch {
    return null;
  }
}

export async function getCategoryTree(locale: string): Promise<Category[]> {
  const { body } = await apiRoot
    .categories()
    .get({ queryArgs: { limit: 200, sort: 'orderHint asc' } })
    .execute();

  const all = body.results.map((c) => mapCategory(c, locale));
  const byId = new Map(all.map((c) => [c.id, { ...c, children: [] as Category[] }]));
  const roots: Category[] = [];
  for (const cat of byId.values()) {
    if (cat.parent) byId.get(cat.parent.id)?.children?.push(cat);
    else roots.push(cat);
  }
  return roots;
}
```

> **CT slug query format:** `where: \`slug(${locale}="${slug}")\`` — locale uses BCP 47 format (`en-US`) here, not the URL segment format (`en-us`). CT stores slugs as `{ "en-US": "my-slug" }`.

---

## Pattern 2: Product Mapper

**INCORRECT:** Passing raw CT `ProductProjection` objects to components — this leaks CT SDK types into the frontend and breaks the boundary.

**CORRECT — map in `lib/mappers/product.ts`, components only receive `Product` from `lib/types.ts`:**

```typescript
// lib/mappers/product.ts
import type { ProductProjection, ProductVariant as CtVariant, Price as CtPrice } from '@commercetools/platform-sdk';
import type { Product, Price, Variant } from '@/lib/types';
import { getLocalizedString } from '@/lib/utils';

function mapPrice(p: CtPrice): Price {
  return {
    centAmount: p.value.centAmount,
    currencyCode: p.value.currencyCode,
    discounted: p.discounted
      ? { centAmount: p.discounted.value.centAmount, currencyCode: p.discounted.value.currencyCode }
      : undefined,
  };
}

function mapVariant(v: CtVariant): Variant {
  return {
    id: v.id,
    sku: v.sku ?? '',
    images: (v.images ?? []).map((img) => img.url),
    price: v.price ? mapPrice(v.price) : undefined,
    prices: (v.prices ?? []).map(mapPrice),
    attributes: (v.attributes ?? []).map((a) => ({ name: a.name, value: a.value })),
    availability: v.availability ? { isOnStock: v.availability.isOnStock } : undefined,
  };
}

export function mapProduct(p: ProductProjection, locale = 'en-US'): Product {
  return {
    type: 'Product',
    id: p.id,
    key: p.key,
    name: getLocalizedString(p.name as Record<string, string>, locale),
    slug: getLocalizedString(p.slug as Record<string, string>, locale),
    description: getLocalizedString(p.description as Record<string, string> | undefined, locale) || undefined,
    categories: (p.categories ?? []).map((c) => ({ id: c.id })),
    variants: [
      mapVariant(p.masterVariant),
      ...(p.variants ?? []).map(mapVariant),
    ],
  };
}
```

---

## Pattern 3: Product Search API

**INCORRECT:** Using `apiRoot.productProjections().search()` (legacy) — no facets, no variant matching, deprecated.

**CORRECT — CT Product Search API v2 (`apiRoot.products().search()`):**

```typescript
// lib/ct/search.ts
import { apiRoot } from './client';
import { DEFAULT_LOCALE } from '@/lib/utils';
import type { ProductSearchRequest } from '@commercetools/platform-sdk';
import { mapProduct } from '@/lib/mappers/product';
import type { Product } from '@/lib/types';

export interface SearchParams {
  query?: string;
  categoryId?: string;
  locale?: string;
  currency?: string;
  country?: string;
  limit?: number;
  offset?: number;
  sort?: Array<{ field: string; order: 'asc' | 'desc' }>;
}

export async function searchProducts(params: SearchParams) {
  const {
    query,
    categoryId,
    locale = DEFAULT_LOCALE.locale,
    currency = DEFAULT_LOCALE.currency,
    country = DEFAULT_LOCALE.country,
    limit = 24,
    offset = 0,
    sort = [{ field: 'createdAt', order: 'desc' as const }],
  } = params;

  const queryParts: unknown[] = [];

  if (query) {
    queryParts.push({
      or: [
        { wildcard: { field: 'name', language: locale, value: `*${query}*`, caseInsensitive: true, boost: 3.0 } },
        { fuzzy: { field: 'name', language: locale, value: query, level: 1 } },
        { exact: { field: 'variants.sku', value: query, caseInsensitive: true } },
      ],
    });
  }

  if (categoryId) {
    queryParts.push({ exact: { field: 'categoriesSubTree', value: categoryId } });
  }

  const searchQuery =
    queryParts.length === 0 ? undefined :
    queryParts.length === 1 ? queryParts[0] :
    { and: queryParts };

  const body: ProductSearchRequest = {
    limit,
    offset,
    markMatchingVariants: true,
    productProjectionParameters: { priceCurrency: currency, priceCountry: country },
    sort: sort as ProductSearchRequest['sort'],
    ...(searchQuery ? { query: searchQuery as ProductSearchRequest['query'] } : {}),
  };

  try {
    const { body: result } = await apiRoot.products().search().post({ body }).execute();
    return {
      total: result.total,
      offset: result.offset,
      limit: result.limit,
      products: result.results
        .map((r) => r.productProjection ? mapProduct(r.productProjection, locale) : undefined)
        .filter((p): p is Product => p !== undefined),
    };
  } catch (err: unknown) {
    // CT throws query_shard_exception when a sort field has no index — fall back to createdAt
    const msg = (err as { body?: { message?: string } }).body?.message ?? '';
    if (msg.includes('query_shard_exception')) {
      const fallback = { ...body, sort: [{ field: 'createdAt', order: 'desc' as const }] };
      const { body: result } = await apiRoot.products().search().post({ body: fallback }).execute();
      return { total: result.total, offset: result.offset, limit: result.limit,
        products: result.results.map((r) => r.productProjection ? mapProduct(r.productProjection, locale) : undefined).filter((p): p is Product => p !== undefined) };
    }
    throw err;
  }
}

export async function getProductBySku(sku: string, locale: string, currency: string, country: string): Promise<Product | null> {
  try {
    const { body } = await apiRoot.products().search().post({
      body: {
        limit: 1,
        query: { exact: { field: 'variants.sku', value: sku } } as ProductSearchRequest['query'],
        productProjectionParameters: { priceCurrency: currency, priceCountry: country, localeProjection: [locale] },
      },
    }).execute();
    const projection = body.results[0]?.productProjection;
    return projection ? mapProduct(projection, locale) : null;
  } catch {
    return null;
  }
}
```

> **Price selection:** Pass `priceCurrency` + `priceCountry` in `productProjectionParameters`. CT selects the correct price tier automatically — variants arrive with `.price` already resolved.

---

## Pattern 4: Product UI Components

`components/product/ProductCard.tsx`:
```typescript
import Image from 'next/image';
import Link from 'next/link';
import type { Product } from '@/lib/types';
import { formatMoney } from '@/lib/utils';

export default function ProductCard({ product, locale = 'en-us' }: { product: Product; locale?: string }) {
  const variant = product.variants[0];
  const image = variant?.images[0];
  const price = variant?.price;

  return (
    <Link href={`/${locale}/${product.slug}/p/${variant?.sku}`} className="group block">
      <div className="aspect-square overflow-hidden rounded-lg bg-cream-dark mb-3">
        {image
          ? <Image src={image} alt={product.name} width={400} height={400} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          : <div className="w-full h-full flex items-center justify-center text-charcoal-light text-sm">No image</div>
        }
      </div>
      <h3 className="font-medium text-charcoal text-sm mb-1 line-clamp-2">{product.name}</h3>
      {price && (
        price.discounted
          ? <div className="flex items-center gap-2">
              <span className="text-terra font-semibold">{formatMoney(price.discounted.centAmount, price.discounted.currencyCode)}</span>
              <span className="text-charcoal-light text-sm line-through">{formatMoney(price.centAmount, price.currencyCode)}</span>
            </div>
          : <span className="font-semibold text-charcoal">{formatMoney(price.centAmount, price.currencyCode)}</span>
      )}
    </Link>
  );
}
```

`components/product/ProductGrid.tsx`:
```typescript
import type { Product } from '@/lib/types';
import ProductCard from './ProductCard';

export default function ProductGrid({ products, locale }: { products: Product[]; locale?: string }) {
  if (products.length === 0) {
    return <div className="text-center py-16 text-charcoal-light">No products found.</div>;
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} locale={locale} />
      ))}
    </div>
  );
}
```

---

## Pattern 5: Category Page (Server Component)

**INCORRECT:** `fetch('/api/products')` from a category page — unnecessary round-trip through the BFF for data that's only ever server-rendered.

**CORRECT — call `lib/ct/*` directly in an async Server Component, parallel-fetch independent data:**

```typescript
// app/[locale]/category/[slug]/page.tsx
import { notFound } from 'next/navigation';
import { getCategoryBySlug, getCategoryTree } from '@/lib/ct/categories';
import { searchProducts, parseSortParam } from '@/lib/ct/search';
import { getLocale } from '@/lib/session';
import ProductGrid from '@/components/product/ProductGrid';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { locale } = await getLocale();
  const category = await getCategoryBySlug(slug, locale).catch(() => null);
  if (!category) return { title: 'Not Found' };
  return { title: category.metaTitle || category.name, description: category.metaDescription };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug, locale: urlLocale } = await params;
  const sp = await searchParams;
  const { country, currency, locale } = await getLocale();

  const limit = 24;
  const offset = parseInt(sp.offset || '0');
  const currentSort = sp.sort ? parseSortParam(sp.sort) : undefined;

  // Parallel fetch — category metadata and category tree at the same time
  const [category, categoryTree] = await Promise.all([
    getCategoryBySlug(slug, locale),
    getCategoryTree(locale),
  ]);
  if (!category) notFound();

  // Build breadcrumb by walking the in-memory tree (no extra CT calls)
  const breadcrumb: Array<{ name: string; slug: string }> = [];
  const flat = categoryTree.flat();
  let current = category;
  while (current.parent) {
    const parent = flat.find((c) => c.id === current.parent?.id);
    if (parent) { breadcrumb.unshift({ name: parent.name, slug: parent.slug }); current = parent; }
    else break;
  }
  breadcrumb.push({ name: category.name, slug });

  const result = await searchProducts({
    categoryId: category.id,
    locale,
    currency,
    country,
    limit,
    offset,
    sort: currentSort ?? [{ field: 'score', order: 'asc' }, { field: 'id', order: 'asc' }],
  });

  const totalPages = Math.ceil(result.total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <nav className="text-sm text-charcoal-light mb-4">
        {breadcrumb.map((b, i) => (
          <span key={b.slug}>
            {i > 0 && <span className="mx-2">/</span>}
            {i < breadcrumb.length - 1
              ? <a href={`/${urlLocale}/category/${b.slug}`} className="hover:text-charcoal">{b.name}</a>
              : <span className="text-charcoal">{b.name}</span>
            }
          </span>
        ))}
      </nav>
      <h1 className="text-3xl font-bold text-charcoal mb-8">{category.name}</h1>
      <ProductGrid products={result.products} locale={urlLocale} />
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-12">
          {Array.from({ length: totalPages }, (_, i) => (
            <a key={i} href={`?offset=${i * limit}`}
               className={`px-4 py-2 rounded border ${i + 1 === currentPage ? 'bg-charcoal text-white border-charcoal' : 'border-border text-charcoal hover:border-charcoal'}`}>
              {i + 1}
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
```

---

## Checklist

- [ ] `lib/ct/categories.ts` exports `getCategoryBySlug`, `getCategoryById`, `getCategoryTree`
- [ ] `lib/mappers/product.ts` exports `mapProduct` — components never receive raw CT types
- [ ] `lib/ct/search.ts` uses `apiRoot.products().search()` (v2 API), not legacy `productProjections`
- [ ] Category page uses `Promise.all` to fetch category + category tree in parallel
- [ ] Breadcrumb walks the in-memory tree — no N+1 parent ID lookups
- [ ] Prices display with discounted amount + strikethrough original when applicable
- [ ] `notFound()` called when category slug doesn't resolve

**Next:** [product-detail.md](./product-detail.md)
