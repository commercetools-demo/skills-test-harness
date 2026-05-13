# Adding a New Page

**Impact: MEDIUM — Using `next/link` instead of the locale-aware `Link`, or omitting `generateMetadata`, creates broken navigation and missing SEO metadata.**

Two patterns: standalone page (most cases) or a layout/sections CMS page (marketing pages).

## Table of Contents
- [Pattern 1: Standalone Page (Server Component)](#pattern-1-standalone-page-server-component)
- [Pattern 2: Locale-Aware Linking](#pattern-2-locale-aware-linking)
- [Pattern 3: Dynamic Routes](#pattern-3-dynamic-routes)
- [Pattern 4: CMS-Driven Layout/Sections Page](#pattern-4-cms-driven-layoutsections-page)
- [Pattern 5: Client Components Within a Server Page](#pattern-5-client-components-within-a-server-page)
- [Checklist](#checklist)

---

## Pattern 1: Standalone Page (Server Component)

**INCORRECT:** Making the page a Client Component or fetching CT directly in the page:

```typescript
// WRONG — no metadata, client component for no reason, direct CT import
'use client';
import { apiRoot } from '@/lib/ct/client';
export default function MyPage() { ... }
```

**CORRECT — async Server Component with `generateMetadata` and CT calls via `lib/ct/`:**

```typescript
// app/[locale]/my-new-page/page.tsx
import type { Metadata } from 'next';
import { getLocale } from '@/lib/session';

// Static metadata
export const metadata: Metadata = {
  title: 'My Page',        // appended to '| Vibe Home' via root layout template
  description: 'Page description for SEO',
};

// Dynamic metadata (when content depends on fetched data)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await fetchSomething(slug).catch(() => null);
  return {
    title: data?.name || 'Not Found',
    description: data?.description,
  };
}

export default async function MyPage() {
  const { locale, currency, country } = await getLocale();
  const data = await fetchMyData(locale);
  return <MyPageContent data={data} />;
}
```

> **Never call CT SDK directly in a page.** Use functions from `lib/ct/` which encapsulate the `apiRoot` calls.

---

## Pattern 2: Locale-Aware Linking

**INCORRECT:** Using `next/link` or `next/navigation` in locale-aware pages:

```typescript
// WRONG — ignores locale prefix, creates broken /en-us/en-us/... URLs
import Link from 'next/link';
import { useRouter } from 'next/navigation';
```

**CORRECT — always import from `@/i18n/routing`:**

```typescript
// ✅ correct — locale prefix handled automatically
import { Link, useRouter, usePathname } from '@/i18n/routing';

// href values are locale-path-agnostic — the routing layer prefixes them
<Link href="/my-new-page">Go to page</Link>
```

The `Link`, `useRouter`, `usePathname`, and `redirect` exports from `@/i18n/routing` are created by `createNavigation(routing)` in `i18n/routing.ts` and handle locale prefixing automatically.

---

## Pattern 3: Dynamic Routes

**INCORRECT:** Not awaiting `params` (Next.js 15+ requirement):

```typescript
// WRONG — params is a Promise in Next.js 15+
export default function Page({ params }: { params: { id: string } }) {
  const { id } = params; // TypeError
```

**CORRECT — `params` is always a `Promise`, always `await` it:**

```typescript
// app/[locale]/my-thing/[id]/page.tsx
interface PageProps {
  params: Promise<{ id: string; locale: string }>;
}

export default async function MyThingPage({ params }: PageProps) {
  const { id } = await params;
  const data = await fetchThing(id);
  if (!data) notFound();
  return <MyThingView data={data} />;
}
```

---

## Pattern 4: CMS-Driven Layout/Sections Page

Use this for marketing-heavy pages (homepage, campaign pages) where content blocks need to be configurable without code changes.

**INCORRECT:** Hardcoding content directly in the JSX of a marketing page:

```typescript
// WRONG — content change requires a code deploy
export default function SalePage() {
  return <div>Summer Sale — 40% off everything!</div>;
}
```

**CORRECT — register a page ID in `lib/layout.ts` and use the sections system:**

```typescript
// 1. Register page ID in lib/layout.ts
export async function getPageSections(pageId: string, locale: string, currency: string, country: string, context?: PageContext) {
  if (pageId === 'sale-campaign') {
    return buildSaleCampaignSections(locale, currency, country);
  }
  // ...
}

// 2. Write the builder function
async function buildSaleCampaignSections(locale: string, currency: string, country: string): Promise<LayoutSection[]> {
  const featured = await searchProducts({ limit: 4, currency, country, locale });
  return [
    {
      sectionId: 'hero',
      configuration: { background: 'Dark' },
      layoutElements: [{
        configuration: { size: 12 },
        items: [{
          layoutItemType: 'content/hero',
          configuration: {
            eyebrow: { 'en-US': 'Summer Sale', 'de-DE': 'Sommerschlussverkauf' },
            headingParts: [{ text: { 'en-US': 'Up to 40% Off' }, highlight: false }],
          },
        }],
      }],
    },
  ];
}

// 3. Create the page file
export default async function SalePage() {
  const { locale, currency, country } = await getLocale();
  const sections = await getPageSections('sale-campaign', locale, currency, country);
  return <Sections sections={sections} />;
}
```

> Localized strings use `{ 'en-US': '...', 'de-DE': '...' }` objects. `localizeConfig()` in `layout.ts` resolves them to plain strings before the sections reach components — no manual locale resolution in components.

---

## Pattern 5: Client Components Within a Server Page

**INCORRECT:** Making the whole page a Client Component to handle interactivity:

```typescript
// WRONG — loses server rendering, all data fetches become client-side
'use client';
export default function MyPage() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/api/data').then(...) }, []);
  // ...
}
```

**CORRECT — keep the page as a Server Component, extract interactive parts:**

```typescript
// page.tsx — Server Component
import MyInteractiveWidget from '@/components/my-page/MyInteractiveWidget';

export default async function MyPage() {
  const data = await fetchData();           // server-side, no loading state
  return <MyInteractiveWidget initialData={data} />;
}

// components/my-page/MyInteractiveWidget.tsx — Client Component
'use client';
export default function MyInteractiveWidget({ initialData }: { initialData: Data }) {
  const [state, setState] = useState(initialData);
  // ... interactive logic
}
```

---

## Checklist

- [ ] Page file at `app/[locale]/my-page/page.tsx`
- [ ] `export const metadata` or `export async function generateMetadata` present
- [ ] `import { Link, useRouter } from '@/i18n/routing'` — never from `next/link` / `next/navigation`
- [ ] Dynamic routes `await params` (Next.js 15+)
- [ ] `notFound()` called for missing required resources
- [ ] Page is an async Server Component by default — `'use client'` only on child components that need it
- [ ] Translations added to `messages/en-us.json`, `messages/en-gb.json`, `messages/de-de.json`
