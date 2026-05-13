# Adding a New Page

## Standalone Page

A standalone page is a regular Next.js route under `app/[locale]/`. All pages are Server Components by default.

### Step 1 — Create the route file

```typescript
// app/[locale]/my-page/page.tsx
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function MyPage({ params }: PageProps) {
  const [{ locale }, session] = await Promise.all([params, getSession()]);

  // Require auth if needed
  if (!session.customerId) redirect(`/${locale}/login`);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1>My Page</h1>
    </div>
  );
}
```

Rules:
- Always `await params` — it's a Promise in Next.js 15+
- `redirect()` for auth guards (server-side)
- No `'use client'` unless the page needs browser APIs or interactivity

### Step 2 — Add navigation link

The Header links are hardcoded in `components/layout/Header.tsx`. Add your page to the nav array there.

---

## Dashboard Page

Dashboard pages live under `app/[locale]/dashboard/` and inherit the dashboard layout (auth guard + BU guard + two-column layout with sidebar).

### Step 1 — Create the page

```typescript
// app/[locale]/dashboard/my-feature/page.tsx
import { getSession } from '@/lib/session';
import { notFound } from 'next/navigation';

export default async function MyFeaturePage() {
  const session = await getSession();

  // Dashboard layout already guards auth — but re-check if you need specific permissions
  if (!session.customerId) notFound();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">My Feature</h1>
      {/* Server-rendered content or Client Component for interactive parts */}
    </div>
  );
}
```

### Step 2 — Add to sidebar nav

```typescript
// app/[locale]/dashboard/layout.tsx  (or the nav items config)
const navItems = [
  { label: t('orders'), href: '/dashboard/orders', icon: '📦', requiredPermissions: [] },
  { label: t('myFeature'), href: '/dashboard/my-feature', icon: '✨', requiredPermissions: ['CreateOrders'] },
];
```

Use `requiredPermissions` to hide the nav item when the associate lacks the required permissions. The dashboard layout renders items filtered through `usePermissions()`.

---

## Page with Interactive Client Parts

Split into a Server Component page and a `'use client'` view component:

```typescript
// app/[locale]/dashboard/my-feature/page.tsx  (Server Component)
import { MyFeatureClient } from './MyFeatureClient';
import { getInitialData } from '@/lib/ct/my-feature';

export default async function MyFeaturePage() {
  const session = await getSession();
  const initialData = await getInitialData(session);
  return <MyFeatureClient initialData={initialData} />;
}

// app/[locale]/dashboard/my-feature/MyFeatureClient.tsx  (Client Component)
'use client';
import useSWR from 'swr';

export function MyFeatureClient({ initialData }) {
  // SWR for subsequent updates
  const { data } = useSWR(..., { fallbackData: initialData });
  return <div>{/* interactive UI */}</div>;
}
```

---

## Page Template: Dashboard Feature

```
app/[locale]/dashboard/my-feature/
  page.tsx            — Server Component, fetches initial data
  MyFeatureClient.tsx — Client Component (only if needed)
  [id]/
    page.tsx          — Detail page
```

---

## Checklist

- [ ] `await params` before using `locale`, `slug`, or other route params
- [ ] Auth check: `redirect('/login')` for public pages, `notFound()` inside dashboard
- [ ] Server Component by default — add `'use client'` only when needed
- [ ] Dashboard pages: add nav item to layout with `requiredPermissions`
- [ ] Interactive parts: split into Server Component + Client view component
- [ ] New page needs a translation key in `messages/` for the nav label
