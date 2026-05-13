# Product Detail Page (PDP)

**URL pattern:** `app/[locale]/[slug]/p/[sku]/page.tsx`

The PDP is a Server Component. It fetches the product by SKU using `session` — this is what injects channel-scoped pricing and store-scoped availability automatically.

## Route Handler

```typescript
// app/[locale]/[slug]/p/[sku]/page.tsx
export default async function ProductDetailPage({ params }: PageProps) {
  const [{ slug, sku }, session] = await Promise.all([params, getSession()]);
  const bcp47 = LANGUAGE_LOCALE_MAP[session.urlLocale ?? session.locale ?? DEFAULT_LOCALE.backendLocale]
    ?.backendLocale ?? DEFAULT_LOCALE.backendLocale;

  const [product, attributeLabels] = await Promise.all([
    getProductBySku(sku, session).catch((e) => {
      console.error('[PDP] getProductBySku failed:', e);
      return null;
    }),
    getAttributeLabels(bcp47).catch(() => ({})),
  ]);

  if (!product) notFound();

  const sections = await getPageSections('pdp', bcp47, entry.currencies[0], entry.country, {
    product,
    attributeLabels,
    sku,
    slug,
  });

  return <Sections sections={sections} />;
}
```

**Why `getProductBySku(sku, session)` instead of `getProductBySku(sku)` alone:**

`getProductBySku` calls `new ProductApi(session)`, which calls `buildProjectionParams()` — this injects `priceChannel: session.distributionChannelId`, `storeProjection: session.storeKey`, and `priceCustomerGroupAssignments` into the CT query. Without passing `session`, the product loads at list-price with no channel filtering.

## CT Lookup — `getProductBySku`

```typescript
// lib/ct/products.ts
export async function getProductBySku(sku: string, session?: Partial<SessionData>): Promise<Product> {
  const s = session ?? (await getSession());
  return new ProductApi(s).getProduct({ skus: [sku] });
}
```

`ProductApi.getProduct()` calls the same `searchProducts` path under the hood — it uses the CT Product Search API with a SKU filter, not the Projections endpoint. This ensures channel-scoped pricing is applied identically to PLP.

## `supplyChannelId` for Availability

Availability (stock) is per-channel in CT. `mapProduct()` receives `session.supplyChannelId` and selects the channel's inventory data:

```typescript
// lib/mappers/product.ts
const channelStock = variant.availability?.channels?.[supplyChannelId];
// channelStock.availableQuantity → use this for in-stock display
// variant.availability.isOnStock → only valid without channel scoping
```

**Never use `variant.availability.isOnStock`** in a B2B context — it aggregates all channels and shows in-stock even if the active store's channel is out of stock.

## PDP Sections (layout system)

`getPageSections('pdp', ...)` returns hardcoded sections from `lib/layout.ts`. The PDP renders:

| Section | Layout item | Notes |
|---|---|---|
| Breadcrumb | `pdp/breadcrumb` | Derived from product name |
| Gallery | `pdp/gallery` | First variant's images by default |
| Title | `pdp/title` | Product name + active SKU |
| Price | `pdp/price` | Channel-scoped via session |
| Variant selector | `pdp/variant-selector` | Controlled by `VARIANT_RENDERER_MAP` |
| Description | `pdp/description` | From product description field |
| Add to cart | `pdp/add-to-cart` | Calls cart API with distributionChannel |
| Purchase list | `pdp/purchase-list` | Add to BU shopping list (requires auth) |
| Info attributes | `pdp/info-attributes` | Attributes listed in `PDP_INFO_ATTRIBUTES` |
| Ratings | `pdp/ratings` | Custom object ratings (optional) |
| Related products | `content/related-products` | Products sharing same category |

## URL Convention

PDP URLs follow `/{locale}/{category-slug}/p/{sku}`:
- `slug` in the URL is the *parent category* slug, used for breadcrumb only — not for the product lookup
- Changing variant → changes `sku` in the URL, `slug` stays the same
- Product lookups always use `sku`, not `slug`

## Metadata

```typescript
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const [{ sku }, session] = await Promise.all([params, getSession()]);
  const product = await getProductBySku(sku, session).catch(() => null);
  if (!product) return {};
  return {
    title: product.metaTitle ?? product.name,
    description: product.metaDescription ?? product.description ?? `${product.name} — available...`,
    openGraph: { ... },
  };
}
```

Pass `session` to `getProductBySku` in metadata too — otherwise a non-channel-scoped product might return a different name/description.

## Checklist

- [ ] Pass `session` to `getProductBySku` — never call without it
- [ ] Use `channelStock.availableQuantity` (not `isOnStock`) for availability display
- [ ] `supplyChannelId` comes from `session` — set during BU selection
- [ ] Variant navigation changes `sku` param, keeps same `slug`
- [ ] `getAttributeLabels(bcp47)` fetches localised attribute labels from CT product types
