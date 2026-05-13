# Product Detail Page

**Impact: HIGH — PDP is the highest-conversion page. Wrong variant URL strategy, missing `notFound()`, or blocking serial fetches all degrade the experience.**

This reference covers the PDP route structure, parallel data fetching, variant selectors, image gallery, and the Add to Cart button.

## Table of Contents
- [Pattern 1: PDP Route Structure](#pattern-1-pdp-route-structure)
- [Pattern 2: PDP Page (Server Component)](#pattern-2-pdp-page-server-component)
- [Pattern 3: Image Gallery Component](#pattern-3-image-gallery-component)
- [Pattern 4: Variant Selectors + Price Display](#pattern-4-variant-selectors--price-display)
- [Pattern 5: Add to Cart Button](#pattern-5-add-to-cart-button)
- [Checklist](#checklist)

---

## Pattern 1: PDP Route Structure

**INCORRECT:** `/products/[id]` — product ID in the URL is not SEO-friendly and doesn't support variant switching.

**CORRECT — `[slug]/p/[sku]` — the slug is for SEO/breadcrumb, the SKU identifies the variant:**

```
app/[locale]/[slug]/p/[sku]/page.tsx
```

URL example: `/en-us/premium-coffee-blend/p/COFFEE-001-250G`

- `[slug]` = product slug (human-readable, for breadcrumb)
- `[sku]` = variant SKU (the specific variant being viewed)

Switching variants changes only the `[sku]` segment — the Server Component re-runs and displays the new variant's images and price.

---

## Pattern 2: PDP Page (Server Component)

**INCORRECT:** Fetching product, category, and attribute labels sequentially (waterfall).

**CORRECT — `Promise.all` for parallel independent fetches:**

```typescript
// app/[locale]/[slug]/p/[sku]/page.tsx
import { notFound } from 'next/navigation';
import { getProductBySku } from '@/lib/ct/search';
import { getCategoryById } from '@/lib/ct/categories';
import { getLocale } from '@/lib/session';
import PDPImages from '@/components/pdp/PDPImages';
import PDPInfo from '@/components/pdp/PDPInfo';
import type { Metadata } from 'next';

interface PageProps {
  params: Promise<{ slug: string; sku: string; locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { sku } = await params;
  const { currency, locale, country } = await getLocale();
  const product = await getProductBySku(sku, locale, currency, country).catch(() => null);
  if (!product) return { title: 'Product Not Found' };
  return {
    title: product.metaTitle || product.name,
    description: product.metaDescription,
    keywords: product.metaKeywords,
  };
}

export default async function ProductPage({ params }: PageProps) {
  const { sku, slug, locale: urlLocale } = await params;
  const { country, currency, locale } = await getLocale();

  const product = await getProductBySku(sku, locale, currency, country);
  if (!product) notFound();

  const activeVariant = product.variants.find((v) => v.sku === sku) ?? product.variants[0];

  // Fetch category for breadcrumb — run concurrently with any other independent data
  let categoryName: string | undefined;
  let categorySlug: string | undefined;
  if (product.categories[0]) {
    const cat = await getCategoryById(product.categories[0].id, locale).catch(() => null);
    if (cat) { categoryName = cat.name; categorySlug = cat.slug; }
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {categoryName && categorySlug && (
        <nav className="text-sm text-charcoal-light mb-6">
          <a href={`/${urlLocale}/category/${categorySlug}`} className="hover:text-charcoal">{categoryName}</a>
          <span className="mx-2">/</span>
          <span className="text-charcoal">{product.name}</span>
        </nav>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        <PDPImages images={activeVariant.images} productName={product.name} />
        <PDPInfo product={product} activeSku={sku} locale={urlLocale} ctLocale={locale} />
      </div>
      {product.description && (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="font-semibold text-charcoal mb-3">Description</h2>
          <p className="text-charcoal-light leading-relaxed">{product.description}</p>
        </div>
      )}
    </main>
  );
}
```

---

## Pattern 3: Image Gallery Component

`components/pdp/PDPImages.tsx`:
```typescript
'use client';

import { useState } from 'react';
import Image from 'next/image';

export default function PDPImages({ images, productName }: { images: string[]; productName: string }) {
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0) {
    return <div className="aspect-square bg-cream-dark rounded-xl flex items-center justify-center text-charcoal-light">No image</div>;
  }

  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-xl bg-cream-dark mb-4">
        <Image src={images[activeIndex]} alt={productName} width={600} height={600}
          className="w-full h-full object-cover" priority />
      </div>
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {images.map((src, i) => (
            <button key={i} onClick={() => setActiveIndex(i)}
              className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-colors ${
                i === activeIndex ? 'border-charcoal' : 'border-border hover:border-charcoal-light'
              }`}>
              <Image src={src} alt={`${productName} ${i + 1}`} width={64} height={64} className="object-cover w-full h-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

> Use `priority` on the main PDP image — it is the LCP element and should preload.

---

## Pattern 4: Variant Selectors + Price Display

**INCORRECT:** Fetching variant data client-side — this causes a loading flash and duplicates CT API calls.

**CORRECT — variant switching changes the URL (re-runs Server Component), all data arrives pre-rendered:**

```typescript
// components/pdp/PDPInfo.tsx
'use client';

import { useRouter } from 'next/navigation';
import type { Product } from '@/lib/types';
import { formatMoney } from '@/lib/utils';
import AddToCartButton from '@/components/product/AddToCartButton';

interface Props {
  product: Product;
  activeSku: string;
  locale: string;    // URL locale (en-us)
  ctLocale: string;  // CT locale (en-US)
}

export default function PDPInfo({ product, activeSku, locale, ctLocale }: Props) {
  const router = useRouter();
  const activeVariant = product.variants.find((v) => v.sku === activeSku) ?? product.variants[0];
  const price = activeVariant?.price;

  // Build variant attribute options for selectors
  function getAttributeOptions(attributeNames: string[]) {
    const result: Record<string, unknown[]> = {};
    for (const name of attributeNames) {
      const values = new Set(product.variants.flatMap((v) => v.attributes.filter((a) => a.name === name).map((a) => a.value)));
      if (values.size > 1) result[name] = [...values];
    }
    return result;
  }

  function selectVariant(attributeName: string, value: unknown) {
    const match = product.variants.find((v) => v.attributes.some((a) => a.name === attributeName && String(a.value) === String(value)));
    if (match) router.push(`/${locale}/${product.slug}/p/${match.sku}`);
  }

  const attributeOptions = getAttributeOptions(['size', 'color']);

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal mb-2">{product.name}</h1>

      {/* Price */}
      <div className="mb-6">
        {price ? (
          price.discounted
            ? <div className="flex items-center gap-3">
                <span className="text-2xl font-bold text-terra">{formatMoney(price.discounted.centAmount, price.discounted.currencyCode, ctLocale)}</span>
                <span className="text-lg text-charcoal-light line-through">{formatMoney(price.centAmount, price.currencyCode, ctLocale)}</span>
              </div>
            : <span className="text-2xl font-bold text-charcoal">{formatMoney(price.centAmount, price.currencyCode, ctLocale)}</span>
        ) : (
          <span className="text-charcoal-light">Price unavailable</span>
        )}
      </div>

      {/* Variant selectors */}
      {Object.entries(attributeOptions).map(([attrName, values]) => {
        const activeValue = activeVariant?.attributes.find((a) => a.name === attrName)?.value;
        return (
          <div key={attrName} className="mb-4">
            <p className="text-sm font-medium text-charcoal mb-2 capitalize">{attrName}</p>
            <div className="flex flex-wrap gap-2">
              {values.map((val) => (
                <button key={String(val)} onClick={() => selectVariant(attrName, val)}
                  className={`px-4 py-2 rounded-full border text-sm transition-colors ${
                    String(activeValue) === String(val) ? 'bg-charcoal text-white border-charcoal' : 'border-border text-charcoal hover:border-charcoal'
                  }`}>
                  {String(val)}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {activeVariant?.availability && (
        <p className={`text-sm mb-4 ${activeVariant.availability.isOnStock ? 'text-sage' : 'text-terra'}`}>
          {activeVariant.availability.isOnStock ? 'In stock' : 'Out of stock'}
        </p>
      )}

      <AddToCartButton
        productId={product.id}
        variantId={activeVariant.id}
        disabled={activeVariant?.availability?.isOnStock === false}
      />
    </div>
  );
}
```

---

## Pattern 5: Add to Cart Button

**INCORRECT:** Calling `fetch('/api/cart/items')` directly inside the button component.

**CORRECT — use `useCartContext` which wraps the mutation and opens the mini-cart:**

```typescript
// components/product/AddToCartButton.tsx
'use client';

import { useState } from 'react';
import { useCartContext } from '@/context/CartContext';

export default function AddToCartButton({ productId, variantId, disabled }: {
  productId: string; variantId: number; disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);
  const { addToCart } = useCartContext();

  async function handleClick() {
    if (disabled || loading) return;
    setLoading(true);
    try {
      await addToCart(productId, variantId, 1);
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (e) {
      console.error('Add to cart failed:', e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleClick} disabled={disabled || loading}
      className="w-full py-4 px-6 bg-charcoal text-white rounded-full font-medium hover:bg-charcoal-light disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
      {loading ? 'Adding…' : added ? 'Added!' : disabled ? 'Out of Stock' : 'Add to Cart'}
    </button>
  );
}
```

`CartContext.addToCart` calls `POST /api/cart/items` and opens the mini-cart drawer. See [cart.md](./cart.md).

---

## Checklist

- [ ] Route at `app/[locale]/[slug]/p/[sku]/page.tsx`
- [ ] `generateMetadata` returns title + description for SEO
- [ ] `notFound()` called when SKU doesn't resolve in CT
- [ ] Main image uses `priority` prop (LCP element)
- [ ] Variant selector pushes new URL (Server Component re-runs) — no client-side fetch
- [ ] Discount price shown with original crossed out
- [ ] Out-of-stock variants disable the Add to Cart button
- [ ] `AddToCartButton` uses `useCartContext`, not direct `fetch`

**Next:** [cart.md](./cart.md)
