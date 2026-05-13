# Bundles

**Impact: MEDIUM — Bundle children must be linked to their parent via a CT custom field (`parentKey`). Without it, removing the parent leaves orphaned child line items in the cart.**

Bundles are implemented as a parent line item with child line items linked by a `parentKey` custom field. All cart operations cascade from parent to children.

## Table of Contents
- [Pattern 1: CT Setup](#pattern-1-ct-setup)
- [Pattern 2: CartLineItem Extension](#pattern-2-cartlineitem-extension)
- [Pattern 3: Cart Operations](#pattern-3-cart-operations)
- [Pattern 4: cart-mapper.ts](#pattern-4-cart-mapperts)
- [Pattern 5: items/route.ts](#pattern-5-itemsroutets)
- [Pattern 6: bundle-utils.ts](#pattern-6-bundle-utilsts)
- [Pattern 7: useCartSWR](#pattern-7-usecartswr)
- [Pattern 8: UI](#pattern-8-ui)

---

## Pattern 1: CT Setup

Create the custom type for line items with a `parentKey` field:

```bash
node tools/create-bundles-custom-type.mjs
```

This creates a CT custom type `line-item-additional-info` with a `parentKey` String field.

In CT Merchant Center, add a bundle attribute to the product type:
- Type: `Set` of `Reference` to `Product`
- Name: `bundledProducts` (or similar)
- Searchable: no

---

## Pattern 2: CartLineItem Extension

```typescript
// site/types/index.ts
export interface CartLineItem {
  id:              string;
  sku:             string;
  name:            string;
  quantity:        number;
  price:           Money;
  totalPrice:      Money;
  imageUrl?:       string;
  // Bundle fields
  key?:            string;              // UUID — set on parent line items
  parentKey?:      string;             // references parent's key — set on children
  bundledItems?:   CartLineItem[];     // populated by bundleItems() — not from CT
}
```

---

## Pattern 3: Cart Operations

**INCORRECT:** adding children without a key link — orphaned on parent removal.

```typescript
// BAD — no parentKey, no way to cascade removal
await addLineItem(cartId, version, childSku, 1);
```

**CORRECT — parent gets UUID key, children reference it via `custom.fields.parentKey`:**

```typescript
// site/lib/ct/cart.ts
import { v4 as uuidv4 } from 'uuid';

export async function addLineItem(
  cartId: string, version: number, sku: string, quantity: number, key?: string
) {
  const action: CartUpdateAction = {
    action: 'addLineItem', sku, quantity,
    ...(key && { key }),
  };
  return applyCartAction(cartId, version, [action]);
}

export async function addBundledLineItems(
  cartId: string, version: number, parentKey: string, childSkus: string[]
) {
  const actions: CartUpdateAction[] = childSkus.map((sku) => ({
    action: 'addLineItem',
    sku,
    quantity: 1,
    custom: {
      type: { key: 'line-item-additional-info' },
      fields: { parentKey },             // ← links child to parent
    },
  }));
  return applyCartAction(cartId, version, actions);
}

// Cascade quantity change to all children
export async function changeLineItemQuantity(
  cart: Cart, lineItemId: string, quantity: number
) {
  const item = cart.lineItems.find((i) => i.id === lineItemId);
  if (!item) throw new Error('Line item not found');

  const actions: CartUpdateAction[] = [
    { action: 'changeLineItemQuantity', lineItemId, quantity },
  ];

  if (item.key) {
    // Also update children
    const children = cart.lineItems.filter(
      (i) => i.custom?.fields?.parentKey === item.key
    );
    for (const child of children) {
      actions.push({ action: 'changeLineItemQuantity', lineItemId: child.id, quantity });
    }
  }
  return applyCartAction(cart.id, cart.version, actions);
}

// Cascade removal to all children
export async function removeLineItem(cart: Cart, lineItemId: string) {
  const item = cart.lineItems.find((i) => i.id === lineItemId);
  if (!item) throw new Error('Line item not found');

  const actions: CartUpdateAction[] = [
    { action: 'removeLineItem', lineItemId },
  ];

  if (item.key) {
    const children = cart.lineItems.filter(
      (i) => i.custom?.fields?.parentKey === item.key
    );
    for (const child of children) {
      actions.push({ action: 'removeLineItem', lineItemId: child.id });
    }
  }
  return applyCartAction(cart.id, cart.version, actions);
}
```

---

## Pattern 4: cart-mapper.ts

Surface `key` and `parentKey` from the CT line item:

```typescript
// site/lib/mappers/cart-mapper.ts
function mapLineItem(ctItem: CtLineItem): CartLineItem {
  return {
    id:         ctItem.id,
    sku:        ctItem.variant?.sku ?? '',
    name:       getLocalizedString(ctItem.name, locale),
    quantity:   ctItem.quantity,
    price:      mapMoney(ctItem.price.value),
    totalPrice: mapMoney(ctItem.totalPrice),
    imageUrl:   ctItem.variant?.images?.[0]?.url,
    key:        ctItem.key,
    parentKey:  ctItem.custom?.fields?.parentKey,
  };
}
```

---

## Pattern 5: items/route.ts

```typescript
// site/app/api/cart/items/route.ts
export async function POST(request: Request) {
  const session = await readSession(request);
  const { sku, quantity, bundledSKUList } = await request.json();

  let cart = await getCart(session.cartId!);
  const parentKey = bundledSKUList?.length ? uuidv4() : undefined;

  cart = await addLineItem(cart.id, cart.version, sku, quantity, parentKey);

  if (parentKey && bundledSKUList?.length) {
    cart = await addBundledLineItems(cart.id, cart.version, parentKey, bundledSKUList);
  }

  return NextResponse.json(mapCart(cart));
}
```

---

## Pattern 6: bundle-utils.ts

```typescript
// site/lib/bundle-utils.ts

/**
 * Groups children under their parent line item.
 * Children (items with parentKey) are moved into parent.bundledItems[].
 */
export function bundleItems(items: CartLineItem[]): CartLineItem[] {
  const parents = items.filter((i) => !i.parentKey);
  const children = items.filter((i) => i.parentKey);

  return parents.map((parent) => ({
    ...parent,
    bundledItems: children.filter((c) => c.parentKey === parent.key),
  }));
}

/**
 * Count only parent/standalone items (exclude children from badge count).
 */
export function cartItemCount(items: CartLineItem[]): number {
  return items.filter((i) => !i.parentKey).reduce((sum, i) => sum + i.quantity, 0);
}
```

---

## Pattern 7: useCartSWR

Apply `bundleItems` in the cart fetcher so all components receive pre-grouped data:

```typescript
// site/hooks/useCart.ts
import { bundleItems } from '@/lib/bundle-utils';

const cartFetcher = async (url: string): Promise<Cart> => {
  const raw = await fetch(url).then((r) => r.json());
  return {
    ...raw,
    lineItems: bundleItems(raw.lineItems ?? []),
  };
};

export function useCart() {
  return useSWR<Cart>('/api/cart', cartFetcher);
}
```

---

## Pattern 8: UI

**CartItem — render bundled children as sub-rows:**

```typescript
// site/components/cart/CartItem.tsx
export default function CartItem({ item }: { item: CartLineItem }) {
  return (
    <div>
      {/* Main item row */}
      <div className="flex items-center gap-4">
        <img src={item.imageUrl} alt={item.name} className="h-16 w-16 object-cover" />
        <div>
          <p className="font-medium">{item.name}</p>
          <p className="text-sm text-gray-500">{formatMoney(item.price)}</p>
        </div>
      </div>

      {/* Bundled children */}
      {item.bundledItems?.map((child) => (
        <div key={child.id} className="ml-8 mt-1 flex items-center gap-2 text-sm text-gray-600">
          <span>+ {child.name}</span>
        </div>
      ))}
    </div>
  );
}
```

**BundleAddToCart** — passes `bundledSKUList` to the API:

```typescript
// site/components/pdp/BundleAddToCart.tsx
'use client';
export default function BundleAddToCart({
  sku, bundledSKUs,
}: { sku: string; bundledSKUs: string[] }) {
  const { mutate } = useCart();

  const handleAdd = async () => {
    await fetch('/api/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, quantity: 1, bundledSKUList: bundledSKUs }),
    });
    mutate();
  };

  return <Button variant="primary" onClick={handleAdd}>Add Bundle to Cart</Button>;
}
```

---

## Checklist
- [ ] `node tools/create-bundles-custom-type.mjs` run — custom type `line-item-additional-info` with `parentKey` field exists in CT
- [ ] `CartLineItem` extended with `key`, `parentKey`, `bundledItems`
- [ ] `addLineItem` accepts optional `key` parameter
- [ ] `addBundledLineItems` creates children with `custom.fields.parentKey`
- [ ] `changeLineItemQuantity` and `removeLineItem` cascade to children by matching `parentKey`
- [ ] `cart-mapper.ts` maps `ctItem.key` and `ctItem.custom.fields.parentKey`
- [ ] `items/route.ts` generates UUID parent key and calls `addBundledLineItems`
- [ ] `bundleItems()` and `cartItemCount()` in `lib/bundle-utils.ts`
- [ ] `bundleItems` applied in `cartFetcher` inside `useCart`
- [ ] `CartItem` renders `item.bundledItems` as sub-rows
- [ ] `BundleAddToCart` component passes `bundledSKUList` to `/api/cart/items`
