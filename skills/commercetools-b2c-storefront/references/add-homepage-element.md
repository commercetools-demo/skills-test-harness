# Add Homepage Element

**Impact: MEDIUM — Adding content to a page requires the layout/sections system in `site/lib/layout.ts`. Skipping registration or typing means your component silently renders nothing.**

New page elements are built as React components, registered in `Item.tsx`, then wired into the correct page builder in `lib/layout.ts`.

## Table of Contents
- [Pattern 1: Architecture Overview](#pattern-1-architecture-overview)
- [Pattern 2: Creating a Component](#pattern-2-creating-a-component)
- [Pattern 3: Registering in Item.tsx](#pattern-3-registering-in-itemtsx)
- [Pattern 4: Adding to getPageSections](#pattern-4-adding-to-getpagesections)

---

## Pattern 1: Architecture Overview

The full render pipeline:

```
getPageSections()         ← lib/layout.ts builder function
  → LayoutSection[]       ← array of rows/sections
    → LayoutElement[]     ← elements inside a section
      → LayoutItem        ← { type, config }
        → Item.tsx        ← dynamic() registry keyed by type
          → React component
```

`localizeConfig()` is called inside `getPageSections` before the config is passed to any component. It recursively resolves every `{ 'en-US': '...', 'de-DE': '...' }` object to a plain string for the active locale. **Components always receive plain strings, never locale maps.**

Data flow example:

```typescript
// lib/layout.ts
const sections = getHomeSections(locale);
// sections[0].elements[0] = {
//   type: 'content/hero-banner',
//   config: { title: 'Sale Now On', ctaLabel: 'Shop Now' }   ← already resolved
// }
```

---

## Pattern 2: Creating a Component

**INCORRECT:** using `any` for props, no `ItemProps` wrapper, wrong hook usage.

```typescript
// BAD
export default function PromoBar({ config }: { config: any }) {
  const [open, setOpen] = useState(false); // client state without 'use client'
  return <div>{config['en-US']?.title}</div>; // locale map not resolved
}
```

**CORRECT — typed `ItemProps<Props>`, localized strings arrive as plain `string`:**

```typescript
// site/components/home/PromoBar.tsx
'use client'; // only if hooks are needed

import type { ItemProps } from '@/lib/layout';

interface PromoBarProps {
  title: string;       // plain string — localizeConfig() resolved it already
  ctaLabel?: string;
  ctaHref?: string;
}

export default function PromoBar({ config }: ItemProps<PromoBarProps>) {
  const { title, ctaLabel = 'Shop Now', ctaHref = '/' } = config;

  return (
    <div className="bg-sage-100 py-3 text-center">
      <p className="text-sm font-medium">{title}</p>
      {ctaLabel && (
        <a href={ctaHref} className="ml-4 text-sm underline">
          {ctaLabel}
        </a>
      )}
    </div>
  );
}
```

> `ItemProps<T>` is `{ config: T }`. Import it from `@/lib/layout`.

---

## Pattern 3: Registering in Item.tsx

**INCORRECT:** static import — defeats code-splitting and breaks the registry pattern.

```typescript
// BAD
import PromoBar from '../home/PromoBar';
const registry = { 'content/promo-bar': PromoBar };
```

**CORRECT — `dynamic()` import, following naming convention `<scope>/<kebab-name>`:**

```typescript
// site/components/grid/Item.tsx
import dynamic from 'next/dynamic';

const registry: Record<string, React.ComponentType<ItemProps<any>>> = {
  // existing entries ...
  'content/hero-banner':    dynamic(() => import('../home/HeroBanner')),
  'content/product-grid':   dynamic(() => import('../home/ProductGrid')),
  'category/page-header':   dynamic(() => import('../category/PageHeader')),
  'pdp/usp-bar':            dynamic(() => import('../pdp/UspBar')),

  // NEW entry
  'content/promo-bar':      dynamic(() => import('../home/PromoBar')),
};

export default function Item({ type, config }: LayoutItem) {
  const Component = registry[type];
  if (!Component) return null;
  return <Component config={config} />;
}
```

Naming convention:
- `content/<name>` — home page or generic content blocks
- `category/<name>` — category listing page blocks
- `pdp/<name>` — product detail page blocks

---

## Pattern 4: Adding to getPageSections

Adding a section to the home page builder with localized config, responsive `size`, and `background`:

```typescript
// site/lib/layout.ts (inside getHomeSections or equivalent)

{
  type: 'content/promo-bar',
  config: {
    title: {
      'en-US': 'Free shipping on orders over $50',
      'de-DE': 'Kostenloser Versand ab 50 €',
    },
    ctaLabel: {
      'en-US': 'Shop Now',
      'de-DE': 'Jetzt shoppen',
    },
    ctaHref: '/sale',
  },
  size: { xs: 12, md: 12 },         // full width on all breakpoints
  background: 'Sage',               // 'Dark' | 'Sage' | 'Charcoal' | undefined
},
```

Available `background` values:
- `'Dark'` — dark navy background, white text
- `'Sage'` — muted green, neutral text
- `'Charcoal'` — dark grey, white text
- `undefined` — transparent / default page background

`size` uses a 12-column grid: `{ xs: 12 }` is full-width, `{ xs: 12, md: 6 }` is half-width on medium+.

---

## Checklist
- [ ] Component lives in the correct subdirectory (`components/home/`, `components/category/`, or `components/pdp/`)
- [ ] Props interface uses `ItemProps<Props>` from `@/lib/layout`
- [ ] `'use client'` added only if the component uses hooks or event handlers
- [ ] Localized string fields typed as `string` (not `Record<string, string>`)
- [ ] `dynamic(() => import(...))` entry added to registry in `components/grid/Item.tsx`
- [ ] `layoutItemType` key follows `<scope>/<kebab-name>` convention
- [ ] Section added to the correct builder in `lib/layout.ts` with `{ 'en-US': ..., 'de-DE': ... }` locale maps
- [ ] Responsive `size` set for all breakpoints needed
