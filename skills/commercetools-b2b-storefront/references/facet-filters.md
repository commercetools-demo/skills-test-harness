# Facet Filters

**The only file you normally need to edit for facet configuration is `lib/ct/facet-config.ts`.**

> **B2B note:** Price facets are intentionally omitted. Channel-scoped pricing makes range filtering unreliable without knowing the active distribution channel. To add them, implement `getExtraFacets()` in `facet-config.ts` with money range expressions scoped to `session.distributionChannelId`.

## Architecture

```
URL params (f.<attr>=<value>)
  → CategoryView.tsx       (parses URL, manages filter state)
  → POST /api/products     (injects facetConfigurations from session locale)
  → ProductSearchFactory   (builds CT ProductSearchRequest with postFilter + facets)
  → CT Product Search API
  → FacetSidebar.tsx       (renders buckets; updates URL on click)
```

Facet definitions are fetched server-side from CT product types via `getSearchableAttributes(locale)` in `lib/ct/facets.ts` and cached in-memory for 60 seconds.

## `FACET_BLOCKLIST`

Attribute IDs to never expose as facets:

```typescript
// lib/ct/facet-config.ts
export const FACET_BLOCKLIST: string[] = [
  'variants.attributes.internal-code',  // format: 'variants.attributes.<name>'
];
```

## `FACET_RENDERER_MAP`

Controls how each facet renders. Facets not listed default to `'pill'`.

```typescript
export const FACET_RENDERER_MAP: Record<string, FacetRenderConfig> = {
  'variants.attributes.color': { renderer: 'color' },
  'variants.attributes.finish-label': { renderer: 'color', urlParam: 'finish' },
};
```

| Renderer | Component | Use for |
|---|---|---|
| `'pill'` | `PillFacet.tsx` | Enum/lenum/number attributes (default) |
| `'color'` | `ColorFacet.tsx` | Color swatches; maps bucket keys to hex via `COLOR_HEX` |
| `'toggle'` | `ToggleFacet.tsx` | Boolean attributes — **auto-applied**, no map entry needed |

## URL Parameter Structure

```
/category/excavators?f.color=yellow&f.iso45001=true
```

- Multiple values: `f.color=yellow,black`
- Boolean toggle: `f.iso45001=true`
- `facetParamKey(attributeId)` strips `variants.attributes.` prefix
- `facetAttributeId(paramKey)` reconstructs the full ID

## Supported CT Attribute Types

| CT Type | Facet field | Notes |
|---|---|---|
| `enum` | `<attr>.key` | Labels from CT enum definitions |
| `lenum` | `<attr>.key` | Localised labels |
| `boolean` | `<attr>` | Auto-renders as toggle |
| `number` | `<attr>` | Numeric bucket pills |

`text`, `ltext`, and reference types are excluded — CT doesn't support distinct facets on them.

## Adding a New Color Facet

1. Add attribute to `FACET_RENDERER_MAP` with `renderer: 'color'`
2. Add color codes to `COLOR_HEX` map in `facet-config.ts`:
   ```typescript
   export const COLOR_HEX: Record<string, string> = {
     'yellow': '#FFD700',
     'black': '#000000',
   };
   ```
3. Ensure the attribute is **searchable** in CT Merchant Center (Product Types → attribute → mark searchable)

## Resilience

If CT rejects a product search request with facet expressions, `POST /api/products` automatically retries without facets — products always load even if facets fail.

## Checklist

- [ ] New facet: attribute is searchable in CT Merchant Center
- [ ] Color facet: add to `FACET_RENDERER_MAP` + add hex codes to `COLOR_HEX`
- [ ] Hidden facet: add `'variants.attributes.<name>'` to `FACET_BLOCKLIST`
- [ ] Custom renderer: add to `FacetRenderer` type, implement component, add branch to `FacetSidebar.tsx`
