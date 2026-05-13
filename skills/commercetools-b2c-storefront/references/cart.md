# Cart

**Impact: CRITICAL — Cart version conflicts (409) and stale `cartId` are the most common production bugs. Every write path must re-fetch version and retry.**

This reference covers CT cart creation, all Route Handlers, `useCartSWR`, `CartContext`, the mini-cart drawer, and the full cart page.

## Table of Contents
- [Pattern 1: CT Cart Helper Functions](#pattern-1-ct-cart-helper-functions)
- [Pattern 2: Cart Route Handlers](#pattern-2-cart-route-handlers)
- [Pattern 3: Cart SWR Hook](#pattern-3-cart-swr-hook)
- [Pattern 4: CartContext](#pattern-4-cartcontext)
- [Pattern 5: Mini-Cart Drawer](#pattern-5-mini-cart-drawer)
- [Checklist](#checklist)

---

## Pattern 1: CT Cart Helper Functions

`lib/ct/cart.ts` (key functions):

```typescript
import { apiRoot } from './client';
import type { BaseAddress, ShippingMethodResourceIdentifier } from '@commercetools/platform-sdk';

export async function getCart(cartId: string) {
  const { body } = await apiRoot.carts().withId({ ID: cartId }).get().execute();
  return body;
}

export async function createCart(currency: string, country: string, customerId?: string) {
  const { body } = await apiRoot.carts().post({
    body: {
      currency,
      country,
      shippingMode: 'Single', // always Single — Multiple mode is legacy
      ...(customerId ? { customerId } : {}),
    },
  }).execute();
  return body;
}

export async function addLineItem(cartId: string, cartVersion: number, productId: string, variantId: number, quantity: number) {
  const { body } = await apiRoot.carts().withId({ ID: cartId }).post({
    body: { version: cartVersion, actions: [{ action: 'addLineItem', productId, variantId, quantity }] },
  }).execute();
  return body;
}

export async function removeLineItem(cartId: string, cartVersion: number, lineItemId: string) {
  const { body } = await apiRoot.carts().withId({ ID: cartId }).post({
    body: { version: cartVersion, actions: [{ action: 'removeLineItem', lineItemId }] },
  }).execute();
  return body;
}

export async function changeLineItemQuantity(cartId: string, cartVersion: number, lineItemId: string, quantity: number) {
  const { body } = await apiRoot.carts().withId({ ID: cartId }).post({
    body: { version: cartVersion, actions: [{ action: 'changeLineItemQuantity', lineItemId, quantity }] },
  }).execute();
  return body;
}

export async function applyDiscountCode(cartId: string, cartVersion: number, code: string) {
  const { body } = await apiRoot.carts().withId({ ID: cartId }).post({
    body: { version: cartVersion, actions: [{ action: 'addDiscountCode', code }] },
  }).execute();
  return body;
}

export async function setCartCustomerId(cartId: string, cartVersion: number, customerId: string) {
  const { body } = await apiRoot.carts().withId({ ID: cartId }).post({
    body: { version: cartVersion, actions: [{ action: 'setCustomerId', customerId }] },
  }).execute();
  return body;
}
```

> **Always `shippingMode: 'Single'`** — Multi mode complicates checkout and is legacy. CT defaults to Single, but specifying it explicitly makes intent clear.

---

## Pattern 2: Cart Route Handlers

### Main cart route (GET/POST/PATCH)

```typescript
// app/api/cart/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getLocale, createSessionToken, setSessionCookie } from '@/lib/session';
import { getCart, createCart, setShippingAddress, setBillingAddress, setShippingMethod } from '@/lib/ct/cart';

export async function GET() {
  const session = await getSession();
  if (!session.cartId) return NextResponse.json({ cart: null });
  try {
    const cart = await getCart(session.cartId);
    // Discard non-Active carts (Ordered, Merged) — client should see empty cart
    if (cart.cartState && cart.cartState !== 'Active') {
      const token = await createSessionToken({ ...session, cartId: undefined });
      const resp = NextResponse.json({ cart: null });
      return setSessionCookie(resp, token);
    }
    return NextResponse.json({ cart });
  } catch {
    // Cart not found in CT — clear stale cartId from session
    const token = await createSessionToken({ ...session, cartId: undefined });
    const resp = NextResponse.json({ cart: null });
    return setSessionCookie(resp, token);
  }
}

export async function POST() {
  const [session, { country, currency }] = await Promise.all([getSession(), getLocale()]);
  const cart = await createCart(currency, country, session.customerId);
  const token = await createSessionToken({ ...session, cartId: cart.id });
  const resp = NextResponse.json({ cart });
  return setSessionCookie(resp, token);
}

// Re-fetch version before each action; retry up to 3 times on 409 ConcurrentModification
async function applyCartAction<T>(cartId: string, action: (version: number) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { version } = await getCart(cartId);
    try {
      return await action(version);
    } catch (e: unknown) {
      if ((e as { statusCode?: number }).statusCode === 409 && attempt < 2) continue;
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session.cartId) return NextResponse.json({ error: 'No cart' }, { status: 400 });
  const { shippingAddress, billingAddress, shippingMethodId } = await req.json();
  if (shippingAddress) await applyCartAction(session.cartId, (v) => setShippingAddress(session.cartId!, v, shippingAddress));
  if (billingAddress) await applyCartAction(session.cartId, (v) => setBillingAddress(session.cartId!, v, billingAddress));
  if (shippingMethodId) await applyCartAction(session.cartId, (v) => setShippingMethod(session.cartId!, v, shippingMethodId));
  const cart = await getCart(session.cartId);
  return NextResponse.json({ cart });
}
```

### Add line item

```typescript
// app/api/cart/items/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession, getLocale, createSessionToken, setSessionCookie } from '@/lib/session';
import { getCart, createCart, addLineItem } from '@/lib/ct/cart';

export async function POST(req: NextRequest) {
  const { productId, variantId, quantity = 1 } = await req.json();
  let session = await getSession();

  // Create cart on demand if it doesn't exist
  if (!session.cartId) {
    const { country, currency } = await getLocale();
    const newCart = await createCart(currency, country, session.customerId);
    session = { ...session, cartId: newCart.id };
  }

  const cart = await getCart(session.cartId!);
  const updated = await addLineItem(session.cartId!, cart.version, productId, variantId, quantity);

  const token = await createSessionToken(session);
  const resp = NextResponse.json({ cart: updated });
  return setSessionCookie(resp, token);
}
```

### Update / remove line item

```typescript
// app/api/cart/items/[itemId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getCart, changeLineItemQuantity, removeLineItem } from '@/lib/ct/cart';

interface Params { params: Promise<{ itemId: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  const { itemId } = await params;
  const { quantity } = await req.json();
  const session = await getSession();
  if (!session.cartId) return NextResponse.json({ error: 'No cart' }, { status: 400 });
  const cart = await getCart(session.cartId);
  const updated = await changeLineItemQuantity(session.cartId, cart.version, itemId, quantity);
  return NextResponse.json({ cart: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { itemId } = await params;
  const session = await getSession();
  if (!session.cartId) return NextResponse.json({ error: 'No cart' }, { status: 400 });
  const cart = await getCart(session.cartId);
  const updated = await removeLineItem(session.cartId, cart.version, itemId);
  return NextResponse.json({ cart: updated });
}
```

---

## Pattern 3: Cart SWR Hook

**INCORRECT:** Calling `fetch('/api/cart')` directly in a component.

**CORRECT — `useCartSWR` + `useCartMutations` in `hooks/useCartSWR.ts`:**

```typescript
// hooks/useCartSWR.ts
'use client';

import useSWR, { useSWRConfig } from 'swr';
import { KEY_CART } from '@/lib/cache-keys';

export interface CartLineItem {
  id: string;
  productId: string;
  name: Record<string, string>;
  variant?: { sku?: string; images?: Array<{ url: string }> };
  totalPrice: { centAmount: number; currencyCode: string };
  quantity: number;
}

export interface Cart {
  id: string;
  version: number;
  lineItems: CartLineItem[];
  totalPrice: { centAmount: number; currencyCode: string };
  cartState?: string;
  discountCodes?: Array<{ discountCode: { id: string }; state: string }>;
}

async function cartFetcher(): Promise<Cart | null> {
  const res = await fetch('/api/cart');
  if (!res.ok) return null;
  const data = await res.json();
  return data.cart ?? null;
}

export function useCartSWR(fallback?: Cart | null) {
  return useSWR<Cart | null>(KEY_CART, cartFetcher, {
    fallbackData: fallback ?? undefined,
    revalidateOnFocus: true,
  });
}

export function useCartMutations() {
  const { mutate } = useSWRConfig();

  async function addItem(productId: string, variantId: number, quantity = 1) {
    const resp = await fetch('/api/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId, variantId, quantity }),
    });
    if (!resp.ok) throw new Error('Failed to add to cart');
    mutate(KEY_CART, (await resp.json()).cart, { revalidate: false });
  }

  async function updateLineItem(lineItemId: string, quantity: number) {
    const resp = await fetch(`/api/cart/items/${lineItemId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity }),
    });
    if (!resp.ok) throw new Error('Failed to update item');
    mutate(KEY_CART, (await resp.json()).cart, { revalidate: false });
  }

  async function removeLineItem(lineItemId: string) {
    const resp = await fetch(`/api/cart/items/${lineItemId}`, { method: 'DELETE' });
    if (!resp.ok) throw new Error('Failed to remove item');
    mutate(KEY_CART, (await resp.json()).cart, { revalidate: false });
  }

  async function applyDiscount(code: string) {
    const resp = await fetch('/api/cart/discount', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Invalid code');
    mutate(KEY_CART, data.cart, { revalidate: false });
  }

  return { addItem, updateLineItem, removeLineItem, applyDiscount };
}
```

> **`mutate(KEY_CART, data.cart, { revalidate: false })`** — updates the SWR cache directly from the API response body without triggering a second fetch. Always prefer this over `mutate(KEY_CART)` (which refetches).

---

## Pattern 4: CartContext

```typescript
// context/CartContext.tsx
'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { useCartSWR, useCartMutations, type Cart } from '@/hooks/useCartSWR';

interface CartContextValue {
  cart: Cart | null | undefined;
  isLoading: boolean;
  showMiniCart: boolean;
  openMiniCart: () => void;
  closeMiniCart: () => void;
  addToCart: (productId: string, variantId: number, quantity?: number) => Promise<void>;
  mutateCart: ReturnType<typeof useCartMutations>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children, initialCart }: { children: ReactNode; initialCart?: Cart | null }) {
  const [showMiniCart, setShowMiniCart] = useState(false);
  const { data: cart, isLoading } = useCartSWR(initialCart);
  const mutations = useCartMutations();

  const addToCart = useCallback(async (productId: string, variantId: number, quantity = 1) => {
    await mutations.addItem(productId, variantId, quantity);
    setShowMiniCart(true);
  }, [mutations]);

  return (
    <CartContext.Provider value={{ cart, isLoading, showMiniCart, openMiniCart: () => setShowMiniCart(true), closeMiniCart: () => setShowMiniCart(false), addToCart, mutateCart: mutations }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCartContext() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCartContext must be inside CartProvider');
  return ctx;
}
```

Add `CartProvider` to `app/[locale]/layout.tsx`. Pass `initialCart` fetched server-side to eliminate the client-side loading state:

```typescript
// app/[locale]/layout.tsx (Server Component)
import { getSession } from '@/lib/session';
import { getCart } from '@/lib/ct/cart';
import { CartProvider } from '@/context/CartContext';

export default async function LocaleLayout({ children }: Props) {
  const session = await getSession();
  const initialCart = session.cartId
    ? await getCart(session.cartId).catch(() => null)
    : null;

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider messages={messages}>
          <CartProvider initialCart={initialCart}>
            <Header />
            {children}
            <MiniCart />
          </CartProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

---

## Pattern 5: Mini-Cart Drawer

See full implementation in the `cart` greenfield skill. Key points:
- Renders only when `showMiniCart === true`
- Backdrop click calls `closeMiniCart()`
- Items use `mutateCart.removeLineItem()` for optimistic removal
- "Proceed to Checkout" link closes the mini-cart

---

## CT Concurrency Notes

**Why 409 errors happen:** CT uses optimistic locking. Every cart update requires the current `version` integer. If two requests arrive simultaneously (e.g. address + shipping method fired at the same time from the checkout page), one will be rejected with `409 ConcurrentModification`.

**The `applyCartAction` helper** (in the cart Route Handler) re-fetches the cart before each operation, capturing the fresh `version`, and retries up to 3 times on 409. This handles both user-triggered concurrency and external modifications (CT Checkout SDK, promotions engine).

---

## Checklist

- [ ] `lib/ct/cart.ts` creates carts with `shippingMode: 'Single'`
- [ ] `GET /api/cart` discards non-Active carts and clears `cartId` from session
- [ ] `POST /api/cart/items` creates cart on demand if `cartId` is absent
- [ ] Cart write Route Handlers use retry-with-version-refresh (the `applyCartAction` pattern)
- [ ] `useCartMutations` updates SWR cache from response body — no extra refetch
- [ ] `CartProvider` wraps the locale layout with `initialCart` from server
- [ ] `KEY_CART` from `lib/cache-keys.ts` is the single SWR key for cart data

**Next:** [checkout.md](./checkout.md)
