# Purchase Lists

Purchase lists are BU-scoped shopping lists — shared within a business unit, used for recurring procurement. They are backed by CT's `ShoppingList` resource accessed through the **as-associate chain**.

**Compare with Wishlists:** Wishlists (personal) use project-level `apiRoot.shoppingLists()` with a `customer(id="...")` filter. Purchase lists use `apiRoot.asAssociate().*.shoppingLists()` with no such filter — all BU members share them.

## CT API Chain

```typescript
// lib/ct/wishlists.ts  (purchase lists, confusingly named)
function asAssociateInStore(associateId: string, businessUnitKey: string) {
  return apiRoot
    .asAssociate()
    .withAssociateIdValue({ associateId })
    .inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey })
    .shoppingLists();
}
```

All CRUD operations go through `asAssociateInStore()`. CT enforces BU-membership at the API level — an associate without access gets a 403.

## CRUD Operations

### Fetch all (BU-scoped)

```typescript
export async function getPurchaseLists(associateId, businessUnitKey, options = {}) {
  const response = await asAssociateInStore(associateId, businessUnitKey)
    .get({
      queryArgs: {
        limit, offset,
        sort: 'lastModifiedAt desc',
        expand: ['lineItems[*].variant'],
      },
    })
    .execute();
  return { results: response.body.results.map(sl => mapPurchaseList(sl, locale)), ... };
}
```

### Create

```typescript
export async function createPurchaseList(associateId, businessUnitKey, storeKey, name, customerId, locale) {
  const body: ShoppingListDraft = {
    name: { [locale]: name },
    customer: { id: customerId, typeId: 'customer' },
    store: { typeId: 'store', key: storeKey },
  };
  const response = await asAssociateInStore(associateId, businessUnitKey).post({ body }).execute();
  return mapPurchaseList(response.body, locale);
}
```

Include `store: { key: storeKey }` in the draft to tie the list to the active store.

### Add/Remove Items

```typescript
// Add
await updatePurchaseList(associateId, businessUnitKey, id, version,
  [{ action: 'addLineItem', productId, variantId, quantity }], locale);

// Remove
await updatePurchaseList(associateId, businessUnitKey, id, version,
  [{ action: 'removeLineItem', lineItemId }], locale);
```

### Delete

```typescript
await asAssociateInStore(associateId, businessUnitKey)
  .withId({ ID: id })
  .delete({ queryArgs: { version } })
  .execute();
```

## API Routes

| Method | Path | CT operation |
|---|---|---|
| `GET` | `/api/purchase-lists` | List for active BU |
| `POST` | `/api/purchase-lists` | Create |
| `GET` | `/api/purchase-lists/[id]` | Get by ID |
| `PUT` | `/api/purchase-lists/[id]` | Update (rename) |
| `DELETE` | `/api/purchase-lists/[id]` | Delete |
| `POST` | `/api/purchase-lists/[id]/items` | Add item |
| `DELETE` | `/api/purchase-lists/[id]/items` | Remove item |

All routes validate `customerId` AND `businessUnitKey` from session:

```typescript
const session = await getSession();
if (!session?.customerId || !session.businessUnitKey) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

## Permission Gate

The purchase list UI should check `CreatePurchaseLists` and `UpdatePurchaseLists` permissions via `usePermissions()`. The dashboard nav item for purchase lists should also be hidden when the associate lacks `ViewPurchaseLists`.

## SWR Hook

```typescript
// hooks/usePurchaseLists.ts
export function usePurchaseLists() {
  const { currentBusinessUnit } = useBusinessUnit();
  const buKey = currentBusinessUnit?.key ?? null;

  return useSWR<PurchaseList[]>(
    buKey ? [KEY_PURCHASE_LISTS, buKey] : null,
    ([, bk]) => purchaseListsFetcher(bk),
    { revalidateOnFocus: false }
  );
}
```

Always use `[KEY, businessUnitKey]` as the cache key — cache auto-invalidates when the user switches BU.

## Dashboard Pages

- `app/[locale]/dashboard/purchase-lists/page.tsx` — list all purchase lists for active BU
- `app/[locale]/dashboard/purchase-lists/[id]/page.tsx` — detail with add-to-cart button per item

## Checklist

- [ ] All CT calls use `asAssociateInStore()` (not project-level `apiRoot.shoppingLists()`)
- [ ] `store: { key: storeKey }` in create draft
- [ ] Route handlers validate `customerId` AND `businessUnitKey`
- [ ] SWR hook uses `[KEY, businessUnitKey]` tuple
- [ ] Permission checks via `usePermissions()` before showing UI actions
