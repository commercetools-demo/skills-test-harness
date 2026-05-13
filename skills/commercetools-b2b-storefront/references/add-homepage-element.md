# Adding a Homepage Element

The homepage and other static pages use a **layout/sections system** defined in `lib/layout.ts`. All layout content is code-driven — no CMS. To add a new element to the homepage, add a section or item to `getPageSections('home', ...)`.

## How It Works

```
lib/layout.ts                  → getPageSections(pageId, locale, currency, country)
                                   returns LayoutSection[]
components/grid/Sections.tsx   → renders LayoutSection[] as a responsive grid
components/grid/LayoutItem.tsx → dispatches layoutItemType → component
```

Each `LayoutSection` contains `layoutElements` (columns), each of which contains `items` (individual components).

## Adding a Section to the Homepage

```typescript
// lib/layout.ts — inside getPageSections() for the 'home' case
{
  sectionId: 'my-new-section',
  configuration: { background: 'White' },  // 'White' | 'Slate' | 'Dark'
  layoutElements: [
    {
      items: [
        {
          layoutItemType: 'content/my-component',
          configuration: {
            title: {
              'en-US': 'My Title',
              'de-DE': 'Mein Titel',
            },
          },
        },
      ],
    },
  ],
},
```

String values can be locale maps `{ 'en-US': '...', 'de-DE': '...' }` — `localizeConfig()` resolves them to plain strings for the current locale.

## Adding a New Layout Item Type

### Step 1 — Create the component

```typescript
// components/grid/items/MyComponent.tsx
'use client';  // only if interactive

interface MyComponentConfig {
  title: string;
  subtitle?: string;
}

export default function MyComponent({ title, subtitle }: MyComponentConfig) {
  return (
    <div className="py-12 text-center">
      <h2 className="text-3xl font-bold">{title}</h2>
      {subtitle && <p className="mt-2 text-gray-600">{subtitle}</p>}
    </div>
  );
}
```

### Step 2 — Register in LayoutItem dispatcher

```typescript
// components/grid/LayoutItem.tsx
import MyComponent from './items/MyComponent';

// Inside the switch/if:
case 'content/my-component':
  return <MyComponent {...(item.configuration as MyComponentConfig)} />;
```

### Step 3 — Add section to `lib/layout.ts`

```typescript
{
  layoutItemType: 'content/my-component',
  configuration: localizeConfig({
    title: {
      'en-US': 'Our Story',
      'de-DE': 'Unsere Geschichte',
    },
  }, locale),
},
```

## Section Configuration

| Property | Type | Options |
|---|---|---|
| `sectionId` | `string` | Any unique string |
| `configuration.background` | `string` | `'White'` (default), `'Slate'`, `'Dark'` |
| `layoutElement.configuration.size` | `number \| ResponsiveSize` | `12` = full width; `{ mobile: 12, tablet: 6, desktop: 6 }` = half |

## Multi-Column Layout

```typescript
{
  sectionId: 'two-column',
  layoutElements: [
    {
      configuration: { size: { mobile: 12, tablet: 6, desktop: 6 } },
      items: [{ layoutItemType: 'content/image', configuration: { src: '/img.jpg' } }],
    },
    {
      configuration: { size: { mobile: 12, tablet: 6, desktop: 6 } },
      items: [{ layoutItemType: 'content/text-block', configuration: { text: '...' } }],
    },
  ],
},
```

## Existing Layout Item Types

| Type | Component | Notes |
|---|---|---|
| `content/hero` | `HeroSection` | Main homepage hero with CTA buttons |
| `content/features` | `FeaturesSection` | Icon + title + description cards |
| `content/products` | `ProductsSection` | Featured product grid |
| `content/quick-links` | `QuickLinksSection` | Dashboard shortcut links |
| `content/related-products` | `RelatedProducts` | Products from same category |
| `category/banner` | `CategoryBanner` | Full-width image with title |
| `category/list` | `CategoryList` | Grid of category cards |
| `pdp/*` | Various | PDP-specific items (see product-detail.md) |

## Checklist

- [ ] New section added to `getPageSections()` for the correct `pageId`
- [ ] New component registered in `LayoutItem.tsx` dispatcher
- [ ] String values use locale maps `{ 'en-US': '...' }` — wrapped in `localizeConfig()`
- [ ] `sectionId` is unique within the page
- [ ] Background and grid size set in `configuration`
