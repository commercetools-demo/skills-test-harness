# Checkout

**Impact: HIGH — The checkout route is the revenue path. A failed order placement or stale cart version drops the conversion entirely.**

This reference covers the shipping methods Route Handler, the `POST /api/checkout` order-placement route, the multi-step checkout page, and the confirmation page.

## Table of Contents
- [Pattern 1: Shipping Methods Route Handler](#pattern-1-shipping-methods-route-handler)
- [Pattern 2: useShippingMethods Hook](#pattern-2-useshippingmethods-hook)
- [Pattern 3: POST /api/checkout — Order Placement](#pattern-3-post-apicheckout--order-placement)
- [Pattern 4: Multi-Step Checkout Page](#pattern-4-multi-step-checkout-page)
- [Pattern 5: Confirmation Page (Server Component)](#pattern-5-confirmation-page-server-component)
- [Checklist](#checklist)

---

## Pattern 1: Shipping Methods Route Handler

**INCORRECT:** Calling `getShippingMethods()` inside a Client Component directly — this leaks server-side CT logic and has no auth guard.

**CORRECT — Route Handler filters rates by currency from the session locale:**

```typescript
// app/api/shipping-methods/route.ts
import { NextResponse } from 'next/server';
import { getShippingMethods } from '@/lib/ct/cart';
import { getLocale } from '@/lib/session';
import { getLocalizedString } from '@/lib/utils';

export async function GET() {
  const { currency } = await getLocale();

  try {
    const result = await getShippingMethods();
    const methods = result.results || [];

    const formatted = methods
      .map((sm) => {
        // Find the matching rate for this currency
        let matchingRate = null;
        for (const zr of sm.zoneRates) {
          for (const rate of zr.shippingRates) {
            if (rate.price.currencyCode === currency && rate.isMatching !== false) {
              matchingRate = rate;
              break;
            }
            if (rate.price.currencyCode === currency && !matchingRate) {
              matchingRate = rate;
            }
          }
          if (matchingRate) break;
        }

        return {
          id: sm.id,
          name: sm.name,
          description: getLocalizedString(sm.localizedDescription),
          price: matchingRate?.price || null,
          freeAbove: matchingRate?.freeAbove || null,
        };
      })
      .filter((sm) => sm.price !== null); // exclude methods with no rate for this currency

    return NextResponse.json({ shippingMethods: formatted });
  } catch {
    return NextResponse.json({ shippingMethods: [] });
  }
}
```

> **Only return methods with a matching rate for the session currency.** A shipping method configured for EUR only must not appear to a USD customer.

---

## Pattern 2: useShippingMethods Hook

```typescript
// hooks/useShippingMethods.ts
'use client';

import useSWR from 'swr';
import { keyShippingMethods } from '@/lib/cache-keys';

export interface ShippingMethod {
  id: string;
  name: string;
  description?: string;
  price: { centAmount: number; currencyCode: string } | null;
  freeAbove: { centAmount: number } | null;
}

async function shippingMethodsFetcher([, country, currency]: [string, string, string]): Promise<ShippingMethod[]> {
  const res = await fetch(`/api/shipping-methods?country=${country}&currency=${currency}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.shippingMethods ?? [];
}

export function useShippingMethods() {
  const { country, currency } = useLocale(); // from LocaleContext
  const key = country && currency ? [keyShippingMethods(country, currency), country, currency] : null;
  return useSWR<ShippingMethod[]>(key, shippingMethodsFetcher, { revalidateOnFocus: false });
}
```

> **`revalidateOnFocus: false`** — Shipping methods change rarely. No need to re-fetch every time the user switches tabs.

---

## Pattern 3: POST /api/checkout — Order Placement

**INCORRECT:** Calling `createOrderFromCart` without first setting shipping address, billing address, and payment — CT will reject the order creation.

**CORRECT — sequential: address → shipping method → billing → payment → order:**

```typescript
// app/api/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession, createSessionToken, setSessionCookie } from '@/lib/session';
import {
  getCart,
  setShippingAddress,
  setBillingAddress,
  setShippingMethod,
  createPayment,
  addPaymentToCart,
  createOrderFromCart,
  getShippingMethods,
} from '@/lib/ct/cart';

export async function POST(req: NextRequest) {
  const { shippingAddress, billingAddress, shippingMethodId } = await req.json();

  const session = await getSession();
  if (!session.cartId) {
    return NextResponse.json({ error: 'No cart found' }, { status: 400 });
  }

  try {
    let cart = await getCart(session.cartId);
    let version = cart.version;

    // 1. Shipping address (required for tax/shipping rate calculation)
    cart = await setShippingAddress(cart.id, version, shippingAddress);
    version = cart.version;

    // 2. Shipping method — use provided ID or fall back to first available
    const shippingMethods = (await getShippingMethods()).results;
    const method = shippingMethodId
      ? shippingMethods.find((sm) => sm.id === shippingMethodId)
      : shippingMethods[0];
    if (method) {
      try {
        cart = await setShippingMethod(cart.id, version, method.id);
        version = cart.version;
      } catch {
        // Non-fatal if no zone matches; continue to order placement
      }
    }

    // 3. Billing address
    cart = await setBillingAddress(cart.id, version, billingAddress);
    version = cart.version;

    // 4. Payment (mock/stripe/adyen — use real payment provider in production)
    const payment = await createPayment(
      cart.totalPrice.currencyCode,
      cart.totalPrice.centAmount,
      session.customerId
    );
    cart = await addPaymentToCart(cart.id, version, payment.id);
    version = cart.version;

    // 5. Create order
    const order = await createOrderFromCart(cart.id, version);

    // 6. Clear cartId from session
    const newSession = { ...session, cartId: undefined };
    const token = await createSessionToken(newSession);
    const resp = NextResponse.json({ orderId: order.id, orderNumber: order.orderNumber });
    setSessionCookie(resp, token);
    return resp;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Checkout failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

> **Always clear `cartId` from the session after order placement.** A completed cart in CT cannot accept further updates — leaving `cartId` in the session causes subsequent cart fetches to hit a non-Active cart, which the GET handler then discards (see cart.md), creating an invisible empty cart.

---

## Pattern 4: Multi-Step Checkout Page

**INCORRECT:** One giant form that submits everything at once — addresses and shipping are validated client-side only, creating invalid CT state.

**CORRECT — three URL-based steps (`/checkout/addresses`, `/checkout/shipping`, `/checkout/payment`), each persisting to the cart in real time via `PATCH /api/cart`:**

```typescript
// app/[locale]/checkout/page.tsx  ← redirect index
'use client';

import { useEffect } from 'react';
import { useRouter } from '@/i18n/routing';
import { useCartSWR } from '@/hooks/useCartSWR';

export default function CheckoutIndexPage() {
  const router = useRouter();
  const { data: cart } = useCartSWR();

  useEffect(() => {
    if (cart === undefined) return; // still loading

    const hasAddr = !!(cart?.shippingAddress?.streetName && cart?.billingAddress?.streetName);
    const hasMethod = !!cart?.shippingInfo;

    if (hasAddr && hasMethod) {
      router.replace('/checkout/payment');
    } else if (hasAddr) {
      router.replace('/checkout/shipping');
    } else {
      router.replace('/checkout/addresses');
    }
  }, [cart]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
```

```typescript
// app/[locale]/checkout/[step]/page.tsx  ← step shell (key structure only)
'use client';

import { useCartSWR } from '@/hooks/useCartSWR';
import { useShippingMethods } from '@/hooks/useShippingMethods';

const STEP_NAMES: Record<1 | 2 | 3, string> = { 1: 'addresses', 2: 'shipping', 3: 'payment' };
const STEP_NUMBERS: Record<string, 1 | 2 | 3> = { addresses: 1, shipping: 2, payment: 3 };

export default function CheckoutStepPage() {
  const { data: cart, mutate: mutateCart } = useCartSWR();
  const { data: shippingMethods = [] } = useShippingMethods();
  // ... address state, billing state, shipping method selection

  // Debounce address updates to cart via PATCH /api/cart
  // When shipping method changes, PATCH /api/cart with shippingMethodId

  // handleSubmit: POST /api/checkout with final addresses + shippingMethodId
  // On success: mutateCart(null, { revalidate: false }); router.push(`/checkout/confirmation/${data.orderId}`)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Steps column */}
      <div className="lg:col-span-3 space-y-3">
        {/* CheckoutStep 1: Addresses */}
        {/* CheckoutStep 2: Shipping Method */}
        {/* CheckoutStep 3: Payment */}
      </div>

      {/* Sticky order summary */}
      <div className="lg:col-span-2">
        <div className="sticky top-24 bg-cream rounded-sm p-5">
          {/* Line items, subtotal, shipping cost, estimated total */}
        </div>
      </div>
    </div>
  );
}
```

**Step skip guard** — redirect back if a step's prerequisites aren't met:

```typescript
useEffect(() => {
  if (cart === undefined) return;
  const hasAddr = !!(cart?.shippingAddress?.streetName && cart?.billingAddress?.streetName);
  const hasMethod = !!cart?.shippingInfo;
  if (step === 'shipping' && !hasAddr) router.replace('/checkout/addresses');
  if (step === 'payment' && (!hasAddr || !hasMethod)) router.replace('/checkout/addresses');
}, [cart]); // eslint-disable-line react-hooks/exhaustive-deps
```

**Real-time address debounce** — patch the cart as the user types (600 ms delay):

```typescript
useEffect(() => {
  const { firstName, lastName, streetName, city, postalCode, country } = shippingAddr;
  if (!firstName || !lastName || !streetName || !city || !postalCode || !country) return;

  const timer = setTimeout(() => {
    fetch('/api/cart', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shippingAddress: toCtAddress(shippingAddr) }),
    })
      .then((r) => r.json())
      .then((data) => mutateCart(data.cart, { revalidate: false }));
  }, 600);

  return () => clearTimeout(timer);
}, [shippingAddr]); // eslint-disable-line react-hooks/exhaustive-deps
```

---

## Pattern 5: Confirmation Page (Server Component)

**INCORRECT:** Reading the order from the client with `useSWR` after redirect — the order might not yet be indexed.

**CORRECT — Server Component reads the order directly from CT by `orderId` from the URL:**

```typescript
// app/[locale]/checkout/confirmation/[orderId]/page.tsx
import { Link } from '@/i18n/routing';
import { getOrderById } from '@/lib/ct/auth';
import { getSession, getLocale } from '@/lib/session';
import { formatMoney, getLocalizedString } from '@/lib/utils';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Order Confirmed' };

interface PageProps { params: Promise<{ orderId: string }> }

export default async function ConfirmationPage({ params }: PageProps) {
  const { locale } = await getLocale();
  const { orderId } = await params;
  const [session] = await Promise.all([getSession()]);

  let order = null;
  try {
    order = await getOrderById(orderId);
  } catch {
    // Order not found — show minimal confirmation without line items
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      {/* Success checkmark */}
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-sage/20">
        <svg className="h-8 w-8 text-sage" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="mb-3 text-3xl font-semibold text-charcoal">Order Confirmed!</h1>
      {order?.orderNumber && (
        <p className="mb-8 text-sm text-charcoal-light">Order #{order.orderNumber}</p>
      )}

      {/* Line items summary */}
      {order?.lineItems && (
        <div className="mb-8 rounded-sm bg-cream p-6 text-left">
          {order.lineItems.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>{getLocalizedString(item.name, locale)} × {item.quantity}</span>
              <span>{formatMoney(item.totalPrice.centAmount, item.totalPrice.currencyCode)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        {session.customerId && (
          <Link href="/account/orders"
            className="rounded-sm bg-charcoal px-6 py-3 text-sm font-medium text-white">
            View My Orders
          </Link>
        )}
        <Link href="/"
          className="rounded-sm border border-border px-6 py-3 text-sm font-medium text-charcoal">
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}
```

---

## Checklist

- [ ] `GET /api/shipping-methods` filters rates by session currency — never returns methods with no matching rate
- [ ] `POST /api/checkout` steps: setShippingAddress → setShippingMethod → setBillingAddress → createPayment → addPaymentToCart → createOrderFromCart
- [ ] `cartId` is cleared from the session cookie after successful order placement
- [ ] Checkout index page redirects to the correct step based on cart state (no `shippingAddress` → `addresses`, no `shippingInfo` → `shipping`, otherwise `payment`)
- [ ] Step skip guard redirects back if prerequisites aren't met
- [ ] Address form debounces PATCH calls with 600 ms delay
- [ ] Empty cart guard shows "continue shopping" link instead of checkout form
- [ ] Confirmation page is a Server Component that fetches order by ID from CT

**Next:** [customer-auth.md](./customer-auth.md)
