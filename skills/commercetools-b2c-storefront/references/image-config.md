# Image Config

**Impact: LOW — All product image URL transforms are in `site/lib/ct/image-config.ts`. Edit the config — never components.**

Three named functions cover the three image contexts. Components import them directly; swap the implementation to change all images site-wide.

## Table of Contents
- [Pattern 1: Three Transform Functions](#pattern-1-three-transform-functions)
- [Pattern 2: Keep `unoptimized: true`](#pattern-2-keep-unoptimized-true)
- [Pattern 3: Suffix Pattern](#pattern-3-suffix-pattern)
- [Pattern 4: CDN Hostname Replacement](#pattern-4-cdn-hostname-replacement)
- [Pattern 5: Imgix and Cloudinary](#pattern-5-imgix-and-cloudinary)
- [Pattern 6: Adding a New Context](#pattern-6-adding-a-new-context)

---

## Pattern 1: Three Transform Functions

```typescript
// site/lib/ct/image-config.ts

/**
 * ProductCard on listing/search pages.
 */
export function transformListingImageUrl(url: string): string {
  return url; // identity by default — override below
}

/**
 * Main carousel image on the PDP.
 */
export function transformDetailImageUrl(url: string): string {
  return url;
}

/**
 * Thumbnail strip on the PDP.
 */
export function transformThumbnailImageUrl(url: string): string {
  return url;
}
```

Each function receives the raw commercetools image URL (e.g. `https://storage.googleapis.com/merchant-center-europe/...`) and returns the transformed URL. Keep the signature — components call these by name.

---

## Pattern 2: Keep `unoptimized: true`

`next.config.ts` sets `images.unoptimized = true`. **Do not remove this.**

CT images come from a CDN that returns `403` or `400` when Next.js appends `?url=...&w=...&q=...` optimisation query params. The transform functions in `image-config.ts` handle sizing directly, making Next.js optimisation redundant.

```typescript
// site/next.config.ts  (do not change)
const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
};
```

---

## Pattern 3: Suffix Pattern

Insert a size suffix **before** the file extension, preserving any query string:

```typescript
// site/lib/ct/image-config.ts

// Inserts '-medium' before the last extension, e.g.:
// .../product.jpg  →  .../product-medium.jpg
// .../product.jpg?v=2  →  .../product-medium.jpg?v=2
function addSuffix(url: string, suffix: string): string {
  return url.replace(/(\.[^./?#]+)($|\?)/, `${suffix}$1$2`);
}

export function transformListingImageUrl(url: string): string {
  return addSuffix(url, '-medium');  // e.g. product-medium.jpg
}

export function transformDetailImageUrl(url: string): string {
  return addSuffix(url, '-large');
}

export function transformThumbnailImageUrl(url: string): string {
  return addSuffix(url, '-small');
}
```

---

## Pattern 4: CDN Hostname Replacement

Swap the GCS origin for a custom CDN hostname:

```typescript
// site/lib/ct/image-config.ts

const CDN = 'https://cdn.example.com';
const ORIGIN = 'https://storage.googleapis.com';

export function transformListingImageUrl(url: string): string {
  return url.replace(ORIGIN, CDN);
}

export function transformDetailImageUrl(url: string): string {
  return url.replace(ORIGIN, CDN);
}

export function transformThumbnailImageUrl(url: string): string {
  return url.replace(ORIGIN, CDN);
}
```

Combine with the suffix pattern if the CDN also uses filename-based sizing.

---

## Pattern 5: Imgix and Cloudinary

**Imgix** — append query params to the imgix domain:

```typescript
// site/lib/ct/image-config.ts
const IMGIX_BASE = 'https://mystore.imgix.net';
const ORIGIN     = 'https://storage.googleapis.com/my-bucket';

export function transformListingImageUrl(url: string): string {
  const path = url.replace(ORIGIN, '');
  return `${IMGIX_BASE}${path}?w=400&h=500&fit=crop&auto=format`;
}

export function transformDetailImageUrl(url: string): string {
  const path = url.replace(ORIGIN, '');
  return `${IMGIX_BASE}${path}?w=800&h=1000&fit=crop&auto=format`;
}

export function transformThumbnailImageUrl(url: string): string {
  const path = url.replace(ORIGIN, '');
  return `${IMGIX_BASE}${path}?w=100&h=125&fit=crop&auto=format`;
}
```

**Cloudinary** — use the fetch delivery URL:

```typescript
// site/lib/ct/image-config.ts
const CLD = 'https://res.cloudinary.com/my-cloud/image/fetch';

export function transformListingImageUrl(url: string): string {
  return `${CLD}/w_400,h_500,c_fill,f_auto,q_auto/${encodeURIComponent(url)}`;
}

export function transformDetailImageUrl(url: string): string {
  return `${CLD}/w_800,h_1000,c_fill,f_auto,q_auto/${encodeURIComponent(url)}`;
}

export function transformThumbnailImageUrl(url: string): string {
  return `${CLD}/w_100,h_125,c_fill,f_auto,q_auto/${encodeURIComponent(url)}`;
}
```

---

## Pattern 6: Adding a New Context

Export a new function from `image-config.ts` and import it in the component:

```typescript
// site/lib/ct/image-config.ts
// New context: cart line item thumbnail
export function transformCartImageUrl(url: string): string {
  return addSuffix(url, '-thumb');
}
```

```typescript
// site/components/cart/CartItem.tsx
import { transformCartImageUrl } from '@/lib/ct/image-config';

<Image
  src={transformCartImageUrl(item.imageUrl)}
  alt={item.name}
  width={80}
  height={80}
/>
```

Do not inline the transform in the component — keeping it in `image-config.ts` means a single config change updates all instances.
