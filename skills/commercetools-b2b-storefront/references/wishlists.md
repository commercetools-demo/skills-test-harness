# Personal Wishlists

Personal wishlists are customer-owned shopping lists — not shared with the business unit. They use CT's `ShoppingList` resource via the **project-level `apiRoot.shoppingLists()`** (not the as-associate chain).

**Compare with Purchase Lists:** Purchase lists use the as-associate chain and are visible to all BU members. Wishlists use `apiRoot.shoppingLists()` with a `customer(id="...")` where clause and are private to the customer.

## CT API Chain

```typescript
// lib/ct/personal-wishlists.ts

// Fetch all for a customer
await apiRoot.shoppingLists().get({
  queryArgs: {
    where: `customer(id="${customerId}")`,
    sort: 'createdAt desc',
    limit, offset,
  },
}).execute();
```

Ownership is enforced in two ways:
1. **Fetch:** `where: customer(id="...")` filter
2. **Read single:** After fetching by ID, verify `list.customer?.id === customerId` in app code — throw `'Not found'` if it doesn't match (prevents ID-guessing attacks)

```typescript
export async function getWishlistById(id: string, customerId: string, locale?: string): Promise<Wishlist> {
  const response = await apiRoot.shoppingLists().withId({ ID: id }).get().execute();
  const list = response.body;
  if (list.customer?.id !== customerId) {
    throw new Error('Not found');  // ownership check in app code
  }
  return mapWishlist(list, locale);
}
```

## CRUD Operations

### Create

```typescript
export async function createWishlist(customerId: string, name: string, locale: string): Promise<Wishlist> {
  const response = await apiRoot
    .shoppingLists()
    .post({
      body: {
        name: { [locale]: name },
        customer: { id: customerId, typeId: 'customer' },
      },
    })
    .execute();
  return mapWishlist(response.body, locale);
}
```

No `store` field — wishlists are not store-scoped.

### Add item

```typescript
export async function addItemToWishlist(id, version, productId, variantId, quantity = 1, locale?) {
  const response = await apiRoot.shoppingLists().withId({ ID: id }).post({
    body: {
      version,
      actions: [{ action: 'addLineItem', productId, variantId, quantity }],
    },
  }).execute();
  return mapWishlist(response.body, locale);
}
```

### Remove item

```typescript
await apiRoot.shoppingLists().withId({ ID: id }).post({
  body: { version, actions: [{ action: 'removeLineItem', lineItemId }] },
}).execute();
```

### Delete

```typescript
await apiRoot.shoppingLists().withId({ ID: id }).delete({ queryArgs: { version } }).execute();
```

## API Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/wishlists` | List for authenticated customer |
| `POST` | `/api/wishlists` | Create |
| `GET` | `/api/wishlists/[id]` | Get by ID (with ownership check) |
| `PUT` | `/api/wishlists/[id]` | Update (rename) |
| `DELETE` | `/api/wishlists/[id]` | Delete |
| `POST` | `/api/wishlists/[id]/items` | Add item |
| `DELETE` | `/api/wishlists/[id]/items` | Remove item |

Route handlers validate `customerId` only (no `businessUnitKey` required — wishlists are personal):

```typescript
const session = await getSession();
if (!session?.customerId) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

## Pages

- `app/[locale]/wishlists/page.tsx` — list personal wishlists
- `app/[locale]/wishlists/[id]/page.tsx` — wishlist detail with add-to-cart per item

Wishlists live at `/wishlists` (not under `/dashboard`) because they are personal, not BU-scoped.

## SWR Hook

```typescript
// hooks/useWishlists.ts
export function useWishlists() {
  const { data: account } = useAccount();
  return useSWR<Wishlist[]>(
    account?.id ? [KEY_WISHLISTS, account.id] : null,
    ([, customerId]) => wishlistsFetcher(customerId),
    { revalidateOnFocus: false }
  );
}
```

Cache key uses `customerId` (not `businessUnitKey`) since wishlists are personal.

## Checklist

- [ ] All CT calls use `apiRoot.shoppingLists()` — NOT the as-associate chain
- [ ] Ownership check: `list.customer?.id === customerId` after single-item fetch
- [ ] No `store` field in the create draft
- [ ] Route handlers validate only `customerId` (not businessUnitKey)
- [ ] SWR cache key uses `[KEY, customerId]`, not `[KEY, businessUnitKey]`
- [ ] Pages at `/wishlists/` not `/dashboard/` (personal, not BU-scoped)
