# Adding a BFF API Endpoint

**Impact: HIGH — `fetch('/api/*')` must never appear in a component or context provider. All API calls belong in `hooks/*Api.ts` functions.**

This reference covers the 3-layer BFF pattern, cache keys, the Route Handler shape, CT helper functions, and SWR hooks with BU-keyed mutations.

## Data Flow Rule

```
Client Component / Context Provider
  → hooks/*Api.ts          plain async functions — owns fetch + error handling
  → Route Handler (app/api/*)   server-only — calls lib/ct/*
  → lib/ct/<namespace>.ts       server-only — calls apiRoot (or as-associate chain)
  → CT API
```

**INCORRECT:**

```typescript
// WRONG — fetch in a component
const res = await fetch('/api/orders');
// WRONG — fetch in a context provider (context is 'use client')
const orders = await fetch('/api/orders').then(r => r.json());
```

**CORRECT — all fetches in `hooks/*Api.ts`:**

```typescript
// hooks/useOrdersApi.ts
export async function ordersFetcher(buKey: string) {
  const res = await fetch(`/api/orders?buKey=${buKey}`);
  if (!res.ok) return [];
  return (await res.json()).orders ?? [];
}

export async function cancelOrderRequest(orderId: string) {
  const res = await fetch(`/api/orders/${orderId}/cancel`, { method: 'POST' });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'Failed to cancel order');
  }
  return res.json();
}
```

## Cache Keys

All SWR cache keys in `lib/cache-keys.ts`:

```typescript
export const KEY_ORDERS = 'orders';
export function keyOrder(id: string) { return `order-${id}`; }

// BU-scoped: always include buKey in the key tuple
export function keyOrdersByBU(buKey: string) {
  return [KEY_ORDERS, buKey] as const;
}
```

## Route Handler Shape

```typescript
// app/api/orders/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getOrders } from '@/lib/ct/orders';

export async function GET() {
  const session = await getSession();
  if (!session.customerId || !session.businessUnitKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const orders = await getOrders(session.customerId, session.businessUnitKey);
    return NextResponse.json({ orders });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to fetch orders';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

B2B Route Handlers always validate **both** `customerId` AND `businessUnitKey` — a logged-in user without a BU context should not proceed.

## CT Helper Function

```typescript
// lib/ct/orders.ts
export async function getOrders(
  associateId: string,
  businessUnitKey: string
): Promise<Order[]> {
  const { body } = await apiRoot
    .asAssociate()
    .withAssociateIdValue({ associateId })
    .inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey })
    .orders()
    .get({ queryArgs: { sort: 'createdAt desc', limit: 20 } })
    .execute();
  return body.results.map(mapOrder); // always map before returning
}
```

## SWR Hook with BU Key

```typescript
// hooks/useOrders.ts
'use client';
import useSWR, { useSWRConfig } from 'swr';
import { KEY_ORDERS } from '@/lib/cache-keys';
import { ordersFetcher } from './useOrdersApi';

export function useOrders() {
  const { currentBusinessUnit } = useBusinessUnit();
  const buKey = currentBusinessUnit?.key ?? null;

  return useSWR<Order[]>(
    buKey ? [KEY_ORDERS, buKey] : null,
    ([, bk]) => ordersFetcher(bk),
    { revalidateOnFocus: false }
  );
}

export function useOrderMutations() {
  const { mutate } = useSWRConfig();
  const { currentBusinessUnit } = useBusinessUnit();

  async function cancelOrder(orderId: string) {
    const updated = await cancelOrderRequest(orderId); // throws on error
    const buKey = currentBusinessUnit?.key;
    if (buKey) mutate([KEY_ORDERS, buKey]); // revalidate list
    mutate(keyOrder(orderId), updated.order, { revalidate: false }); // update detail
  }

  return { cancelOrder };
}
```

## Checklist

- [ ] `fetch('/api/*')` only in `hooks/*Api.ts` — never in component or context files
- [ ] Cache key added to `lib/cache-keys.ts`
- [ ] BU-scoped hooks use `[KEY, businessUnitKey]` tuple — `null` when buKey absent
- [ ] Route Handler validates `customerId` AND `businessUnitKey`
- [ ] CT calls in `lib/ct/<namespace>.ts`, responses mapped to app types
- [ ] Mutations throw on error; read hooks return safe defaults
- [ ] After mutation: `mutate([KEY, buKey])` to invalidate list; `mutate(keyItem(id), data, { revalidate: false })` to update detail
