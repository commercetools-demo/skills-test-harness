# Cart — as-associate CRUD

**Impact: CRITICAL — All B2B cart operations must go through the as-associate chain. Using the project-level `apiRoot.carts()` bypasses associate permission enforcement and breaks B2B semantics.**

This reference covers the as-associate chain helper, cart creation with BU+store context, auto-creation on first item add, the CartContext, and the distribution channel on line items.

## Table of Contents
- [Pattern 1: The as-associate Chain](#pattern-1-the-as-associate-chain)
- [Pattern 2: Cart Creation with BU + Store Context](#pattern-2-cart-creation-with-bu--store-context)
- [Pattern 3: Auto-Creation on First Item Add](#pattern-3-auto-creation-on-first-item-add)
- [Pattern 4: CartContext and SWR](#pattern-4-cartcontext-and-swr)
- [Pattern 5: Distribution Channel on Line Items](#pattern-5-distribution-channel-on-line-items)
- [Checklist](#checklist)

---

## Pattern 1: The as-associate Chain

**INCORRECT:** Using project-level `apiRoot.carts()` for a logged-in associate:

```typescript
// WRONG — bypasses CT associate permission enforcement
const { body } = await apiRoot.carts().post({ body: cartDraft }).execute();
const { body } = await apiRoot.carts().withId({ ID: cartId }).post({
  body: { version, actions },
}).execute();
```

**CORRECT — every cart operation goes through the as-associate helper:**

```typescript
// lib/ct/cart.ts
function asAssociateInStore(associateId: string, businessUnitKey: string) {
  return apiRoot
    .asAssociate()
    .withAssociateIdValue({ associateId })
    .inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey })
    .carts();
}

// ✅ All cart functions use this helper:
export async function getCartById(cartId, associateId, businessUnitKey, _storeKey, locale?) {
  const { body } = await asAssociateInStore(associateId, businessUnitKey)
    .withId({ ID: cartId })
    .get()
    .execute();
  return mapCart(body, locale);
}

export async function updateCart(cartId, version, actions, associateId, businessUnitKey, _storeKey, locale?) {
  const { body } = await asAssociateInStore(associateId, businessUnitKey)
    .withId({ ID: cartId })
    .post({ body: { version, actions } })
    .execute();
  return mapCart(body, locale);
}
```

> The `associateId` parameter is always `session.customerId`. The `businessUnitKey` parameter is always `session.businessUnitKey`. Both are required for CT to evaluate associate permissions.

---

## Pattern 2: Cart Creation with BU + Store Context

**INCORRECT:** Creating a cart without business unit or store reference:

```typescript
// WRONG — cart not associated with the BU or store; associate permissions not applied
const { body } = await apiRoot.carts().post({
  body: { currency, country },
}).execute();
```

**CORRECT — cart draft includes both `businessUnit` and `store` references:**

```typescript
// lib/ct/cart.ts
export async function createCart(
  customerId: string,
  associateId: string,
  businessUnitKey: string,
  storeKey: string,
  currency = 'USD',
  country = 'US'
): Promise<Cart> {
  const { body } = await asAssociateInStore(associateId, businessUnitKey)
    .post({
      body: {
        currency,
        country,
        customerId,
        businessUnit: {
          key: businessUnitKey,
          typeId: 'business-unit',
        },
        store: {
          key: storeKey,
          typeId: 'store',
        },
      },
    })
    .execute();
  return mapCart(body);
}
```

**In the Route Handler:**

```typescript
// app/api/cart/route.ts (POST)
const session = await getSession();
const { customerId, businessUnitKey, storeKey, currency, country } = session;

if (!customerId || !businessUnitKey || !storeKey) {
  return NextResponse.json({ error: 'No active business unit' }, { status: 400 });
}

const cart = await createCart(
  customerId,
  customerId,        // associateId = customerId in B2B
  businessUnitKey,
  storeKey,
  currency ?? 'USD',
  country ?? 'US'
);

// Write cartId to session
const response = NextResponse.json({ cart });
await setSession(response, { ...session, cartId: cart.id });
return response;
```

---

## Pattern 3: Auto-Creation on First Item Add

**INCORRECT:** Requiring a separate "create cart" step before adding items:

```typescript
// WRONG — client must always pre-create a cart; extra round-trip
if (!session.cartId) {
  const { cart } = await fetch('/api/cart', { method: 'POST' }).then(r => r.json());
  session.cartId = cart.id;
}
await addItem(session.cartId, productId, variantId, qty);
```

**CORRECT — `POST /api/cart/items` creates the cart on first use if `session.cartId` is absent:**

```typescript
// app/api/cart/items/route.ts
export async function POST(request: NextRequest) {
  let session = await getSession();
  const { productId, variantId, quantity } = await request.json();
  const { customerId, businessUnitKey, storeKey } = session;

  if (!customerId || !businessUnitKey || !storeKey) {
    return NextResponse.json({ error: 'No active business unit' }, { status: 400 });
  }

  // Auto-create cart if none exists
  let cartId = session.cartId;
  if (!cartId) {
    const newCart = await createCart(
      customerId, customerId, businessUnitKey, storeKey,
      session.currency ?? 'USD', session.country ?? 'US'
    );
    cartId = newCart.id;
    // Write cartId before the item add — so it is persisted even if addLineItem fails
    const tempResponse = NextResponse.next();
    session = { ...session, cartId };
    await setSession(tempResponse, session);
  }

  // Resolve distributionChannelId from store (shared cache)
  const { distributionChannelId } = await getStoreChannelData(storeKey);

  const updatedCart = await addLineItem(
    cartId, /* version fetched internally */,
    productId, variantId, quantity,
    customerId, businessUnitKey, storeKey,
    distributionChannelId,
    session.locale
  );

  const response = NextResponse.json({ cart: updatedCart });
  await setSession(response, { ...session, cartId: updatedCart.id });
  return response;
}
```

---

## Pattern 4: CartContext and SWR

**INCORRECT:** Fetching the cart independently in each component that needs it:

```typescript
// WRONG — multiple fetches, no shared state, no optimistic updates
const { data: cart } = useSWR('cart', () => fetch('/api/cart').then(r => r.json()));
```

**CORRECT — `CartContext` owns all cart state, backed by a single SWR key:**

```typescript
// context/CartContext.tsx (key excerpts)
'use client';

const KEY_CART = 'cart';

export function CartProvider({ children }) {
  const [cart, setCart] = useState<Cart | null>(null);

  const { data: cartData, mutate } = useSWR(
    KEY_CART,
    cartFetcher,       // from hooks/useCartApi.ts
    { revalidateOnFocus: false }
  );

  // Sync SWR data → local state
  useEffect(() => {
    setCart(cartData?.cart ?? null);
  }, [cartData]);

  const addItem = useCallback(async (productId, variantId, quantity) => {
    const updated = await addCartItemRequest(productId, variantId, quantity);
    // Update SWR cache directly from response — no extra round-trip
    await mutate({ cart: updated }, { revalidate: false });
  }, [mutate]);

  return (
    <CartContext.Provider value={{ cart, addItem, /* ... */ }}>
      {children}
    </CartContext.Provider>
  );
}
```

> After any successful mutation (add, update, remove), call `mutate({ cart: updated }, { revalidate: false })` to update the SWR cache directly from the response. This avoids the extra GET round-trip.

---

## Pattern 5: Distribution Channel on Line Items

**INCORRECT:** Adding line items without a distribution channel reference:

```typescript
// WRONG — line items not associated with the distribution channel;
// CT may pick a wrong price or no price
const action: CartAddLineItemAction = {
  action: 'addLineItem',
  productId,
  variantId,
  quantity,
};
```

**CORRECT — always pass `distributionChannelId` from `getStoreChannelData`:**

```typescript
// lib/ct/cart.ts
export async function addLineItem(
  cartId: string, version: number,
  productId: string, variantId: number, quantity: number,
  associateId: string, businessUnitKey: string, storeKey: string,
  distributionChannelId?: string,
  locale?: string
): Promise<Cart> {
  const action: CartAddLineItemAction = {
    action: 'addLineItem',
    productId,
    variantId,
    quantity,
    // Channel reference ensures CT uses the correct distribution channel price
    ...(distributionChannelId
      ? { distributionChannel: { id: distributionChannelId, typeId: 'channel' } }
      : {}),
  };

  const { body } = await asAssociateInStore(associateId, businessUnitKey)
    .withId({ ID: cartId })
    .post({ body: { version, actions: [action] } })
    .execute();
  return mapCart(body, locale);
}
```

---

## Checklist

- [ ] All cart read/write operations use `asAssociateInStore(session.customerId, session.businessUnitKey)`
- [ ] Cart draft includes both `businessUnit: { key, typeId: 'business-unit' }` and `store: { key, typeId: 'store' }`
- [ ] `POST /api/cart/items` creates the cart automatically when `session.cartId` is absent
- [ ] `distributionChannelId` from `getStoreChannelData(storeKey)` passed to `addLineItem`
- [ ] CartContext wraps `mutate({ cart: updated }, { revalidate: false })` after every mutation
- [ ] `cartId` written to session after cart creation
- [ ] `session.cartId` cleared after successful order placement or quote request creation
