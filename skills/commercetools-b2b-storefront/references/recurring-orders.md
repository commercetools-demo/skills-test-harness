# Recurring Orders

Recurring orders let B2B buyers automate repeat procurement. CT models them as `RecurringOrder` resources backed by a cart and a `RecurrencePolicy` (the schedule).

## CT Resources

| Resource | Description |
|---|---|
| `RecurringOrder` | `apiRoot.recurringOrders()` — the scheduled order instance |
| `RecurrencePolicy` | `apiRoot.recurrencePolicies()` — defines the schedule (weekly, monthly, etc.) |

**Note:** Recurring orders use project-level `apiRoot`, not the as-associate chain. CT does not yet expose recurring orders under the as-associate endpoint. Authorization is enforced by filtering on `businessUnit(key="...")` in the `where` clause.

## Fetching

```typescript
// lib/ct/recurring-orders.ts
export async function getRecurringOrders(
  customerId: string,
  businessUnitKey: string,
  options: { limit?: number; offset?: number; states?: RecurringOrderState[]; locale?: string } = {}
) {
  const whereClauses = [`businessUnit(key="${businessUnitKey}")`];
  if (states?.length) {
    whereClauses.push(`recurringOrderState in (${states.map(s => `"${s}"`).join(',')})`);
  }

  const response = await apiRoot
    .recurringOrders()
    .get({
      queryArgs: {
        where: whereClauses.join(' and '),
        limit, offset,
        sort: 'createdAt desc',
        expand: ['cart'],
      },
    })
    .execute();

  return {
    results: response.body.results.map(o => mapRecurringOrder(o, locale)),
    total: response.body.total,
    ...
  };
}
```

## State Transitions

Pause, resume, cancel: all use `updateRecurringOrderState()` with a read-then-write pattern to avoid version conflicts.

```typescript
export async function updateRecurringOrderState(id: string, state: RecurringOrderStateDraft, locale?: string) {
  const current = await apiRoot.recurringOrders().withId({ ID: id }).get().execute();
  const response = await apiRoot
    .recurringOrders()
    .withId({ ID: id })
    .post({
      body: {
        version: current.body.version,
        actions: [{ action: 'setRecurringOrderState', recurringOrderState: state }],
      },
    })
    .execute();
  return mapRecurringOrder(response.body, locale);
}
```

**States:** `{ type: 'active' }` | `{ type: 'paused' }` | `{ type: 'cancelled' }`

## API Routes

| Method | Path | Action |
|---|---|---|
| `GET` | `/api/recurring-orders` | List (filtered by BU from session) |
| `GET` | `/api/recurring-orders/[id]` | Detail |
| `POST` | `/api/recurring-orders/[id]/pause` | `setRecurringOrderState { type: 'paused' }` |
| `POST` | `/api/recurring-orders/[id]/resume` | `setRecurringOrderState { type: 'active' }` |
| `POST` | `/api/recurring-orders/[id]/cancel` | `setRecurringOrderState { type: 'cancelled' }` |
| `POST` | `/api/recurring-orders/[id]/duplicate` | Create new from same cart |

All routes read `session.businessUnitKey` for the BU filter. Only `customerId` is required for auth (not businessUnitKey) because CT filters are in the where clause.

## Duplicate

Duplicate creates a new recurring order from the same cart (useful for re-activating a cancelled order with the same items):

```typescript
export async function duplicateRecurringOrder(id: string, locale?: string) {
  const current = await apiRoot
    .recurringOrders()
    .withId({ ID: id })
    .get({ queryArgs: { expand: ['cart'] } })
    .execute();

  return createRecurringOrder({
    cartId: current.body.cart.id,
    cartVersion: current.body.cart.obj?.version ?? 1,
  }, locale);
}
```

## Create (from cart)

```typescript
export async function createRecurringOrder(draft: {
  cartId: string;
  cartVersion: number;
  startsAt?: string;  // ISO 8601
  expiresAt?: string;
}, locale?: string) {
  const response = await apiRoot
    .recurringOrders()
    .post({
      body: {
        cart: { id: draft.cartId, typeId: 'cart' },
        cartVersion: draft.cartVersion,
        ...(draft.startsAt && { startsAt: draft.startsAt }),
        ...(draft.expiresAt && { expiresAt: draft.expiresAt }),
      },
    })
    .execute();
  return mapRecurringOrder(response.body, locale);
}
```

## Recurrence Policies

Policies are defined in CT (not by the app). The app lists available policies so users can pick a schedule:

```typescript
export async function getRecurrencePolicies(options: { limit?: number; locale?: string } = {}) {
  const response = await apiRoot.recurrencePolicies().get({ queryArgs: { limit: 50 } }).execute();
  return response.body.results.map(policy => ({
    id: policy.id,
    key: policy.key,
    name: localizedString(policy.name, locale),
    schedule: policy.schedule,
  }));
}
```

## Dashboard Pages

- `app/[locale]/dashboard/recurring-orders/page.tsx` — list with state filter tabs
- `app/[locale]/dashboard/recurring-orders/[id]/page.tsx` — detail with pause/resume/cancel actions

## Checklist

- [ ] Use `where: businessUnit(key="...")` to scope fetches to the active BU
- [ ] State transitions use read-then-write (fetch version first)
- [ ] Duplicate reuses the existing cart ID from the original recurring order
- [ ] Recurrence policies fetched from CT — not hardcoded in the app
- [ ] Route handlers only require `customerId` auth check (BU filter is in the query)
