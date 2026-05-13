# Search & Facets

**Impact: MEDIUM — All facet configuration lives in `site/lib/ct/facet-config.ts`. Facets from searchable CT product type attributes appear automatically as `'pill'` facets — only configure when you need a different renderer, URL param, or want to block one.**

## Table of Contents
- [Pattern 1: How Facets Work](#pattern-1-how-facets-work)
- [Pattern 2: FACET_RENDERER_MAP](#pattern-2-facet_renderer_map)
- [Pattern 3: FACET_BLOCKLIST](#pattern-3-facet_blocklist)
- [Pattern 4: Extra Facets](#pattern-4-extra-facets)
- [Pattern 5: Adding a Custom Renderer](#pattern-5-adding-a-custom-renderer)

---

## Pattern 1: How Facets Work

The full pipeline from config to rendered UI:

```
getSearchableAttributes()       ← fetches CT product type attributes marked searchable
  → searchProducts()            ← filters through FACET_BLOCKLIST, appends extra facets
    → facetDefinitionsToFacetExpressions()  ← builds CT query filter expressions
      → CT Product Projection Search API
        → mapFacets()           ← maps CT facet results to app FacetResult[]
          → ProductFilters      ← uses FACET_RENDERER_MAP to pick renderer per facet
```

Key points:
- Attributes marked as **searchable** in CT Merchant Center appear automatically
- You only need config entries for non-default renderers, URL param overrides, or blocking
- `FACET_BLOCKLIST` entries are full attribute paths (e.g. `variants.attributes.color-code`)

---

## Pattern 2: FACET_RENDERER_MAP

Maps a CT attribute path to `{ renderer, urlParam }`. Renderers: `'pill'` (default), `'color'` (swatches), `'toggle'` (auto for boolean), `'range'` (auto for money).

```typescript
// site/lib/ct/facet-config.ts
export type FacetRenderer = 'pill' | 'color' | 'toggle' | 'range';

export const FACET_RENDERER_MAP: Record<string, { renderer: FacetRenderer; urlParam?: string }> = {
  // Color attribute — show as circular swatches
  'variants.attributes.color-label': {
    renderer: 'color',
    urlParam: 'color',           // URL: ?color=Red (instead of ?variants.attributes.color-label=Red)
  },

  // Size — pill (explicit, same as default)
  'variants.attributes.size': {
    renderer: 'pill',
    urlParam: 'size',
  },

  // Boolean attribute — toggle
  'variants.attributes.inStock': {
    renderer: 'toggle',
    urlParam: 'inStock',
  },

  // Price range — range slider (added via getExtraFacets, not product type attribute)
  'variants.price': {
    renderer: 'range',
    urlParam: 'price',
  },
};
```

Attributes **not** in this map use `'pill'` renderer and the full attribute path as the URL param.

---

## Pattern 3: FACET_BLOCKLIST

Array of full attribute paths to suppress from the facet UI.

```typescript
// site/lib/ct/facet-config.ts
export const FACET_BLOCKLIST: string[] = [
  'variants.attributes.color-code',    // raw hex — companion to color-label, shown as swatch fill
  'variants.attributes.finish-code',   // raw hex companion to finish
  'variants.attributes.sku',
  'variants.attributes.articleNumber',
];
```

Always block companion hex/code attributes that are rendered as swatch fills — they appear as raw hex values if shown as pills.

---

## Pattern 4: Extra Facets

`getExtraFacets()` injects facets not derived from CT product type attributes (e.g. price range).

```typescript
// site/lib/ct/facet-config.ts
export function getExtraFacets(t: TranslationFn): FacetDefinition[] {
  return [
    {
      attributePath: 'variants.price',
      label:         t('filters.price'),
      attributeType: 'money',         // auto-selects MoneyRangeFacet renderer
      ranges: [
        { from: 0,      to: 2500  },  // values in cents
        { from: 2500,   to: 5000  },
        { from: 5000,   to: 10000 },
        { from: 10000,  to: 25000 },
        { from: 25000              },  // open-ended upper bound
      ],
    },
  ];
}
```

`attributeType: 'money'` causes `ProductFilters` to render `MoneyRangeFacet` automatically without a `FACET_RENDERER_MAP` entry.

---

## Pattern 5: Adding a Custom Renderer

1. Create the component in `components/product/facets/`:

```typescript
// site/components/product/facets/RatingFacet.tsx
'use client';
import type { FacetResult } from '@/types';

export default function RatingFacet({
  facet,
  selected,
  onToggle,
}: {
  facet: FacetResult;
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">{facet.label}</p>
      {facet.terms.map((term) => (
        <button
          key={term.value}
          onClick={() => onToggle(term.value)}
          className={selected.includes(term.value) ? 'text-yellow-500' : 'text-gray-400'}
        >
          {'★'.repeat(Number(term.value))} ({term.count})
        </button>
      ))}
    </div>
  );
}
```

2. Add to `FacetRenderer` type in `facet-config.ts`:

```typescript
export type FacetRenderer = 'pill' | 'color' | 'toggle' | 'range' | 'rating';
```

3. Wire into the switch in `ProductFilters.tsx`:

```typescript
// site/components/product/ProductFilters.tsx
import RatingFacet from './facets/RatingFacet';

// Inside the render switch:
case 'rating':
  return <RatingFacet facet={facet} selected={selected} onToggle={onToggle} />;
```

4. Register in `FACET_RENDERER_MAP`:

```typescript
'variants.attributes.rating': {
  renderer: 'rating',
  urlParam: 'rating',
},
```

---

## Checklist
- [ ] Attribute marked as **searchable** in CT Merchant Center (Attribute Definitions → search flag)
- [ ] Attribute path is **not** in `FACET_BLOCKLIST`
- [ ] `FACET_RENDERER_MAP` entry added if a non-pill renderer is needed
- [ ] `urlParam` set in `FACET_RENDERER_MAP` to shorten URL query params
- [ ] Companion hex/code attributes (e.g. `color-code`) added to `FACET_BLOCKLIST`
- [ ] Custom renderer component created in `components/product/facets/` and wired into `ProductFilters.tsx` switch
