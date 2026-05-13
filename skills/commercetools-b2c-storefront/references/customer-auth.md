# Customer Authentication

**Impact: HIGH — The wrong login endpoint or missing anonymous-cart merge silently loses the customer's cart on every login.**

This reference covers the CT login endpoint, register/login/logout Route Handlers, anonymous cart merge, the `useAccount` SWR hook, and the protected account layout.

## Table of Contents
- [Pattern 1: CT Auth Helper Functions](#pattern-1-ct-auth-helper-functions)
- [Pattern 2: Login Route Handler](#pattern-2-login-route-handler)
- [Pattern 3: Register and Logout Route Handlers](#pattern-3-register-and-logout-route-handlers)
- [Pattern 4: useAccount Hook](#pattern-4-useaccount-hook)
- [Pattern 5: Protected Account Layout](#pattern-5-protected-account-layout)
- [Checklist](#checklist)

---

## Pattern 1: CT Auth Helper Functions

**INCORRECT:** `apiRoot.customers().login()` — this endpoint does not exist in the CT SDK v2.

**CORRECT — `apiRoot.login().post()` with anonymous cart merge:**

```typescript
// lib/ct/auth.ts
import { apiRoot } from './client';
import type { CustomerUpdateAction } from '@commercetools/platform-sdk';

export async function signInCustomer(email: string, password: string, anonymousCartId?: string) {
  const { body } = await apiRoot
    .login()
    .post({
      body: {
        email,
        password,
        ...(anonymousCartId
          ? {
              anonymousCartId,
              anonymousCartSignInMode: 'MergeWithExistingCustomerCart',
            }
          : {}),
      },
    })
    .execute();
  return body; // { customer, cart? }
}

export async function signUpCustomer(data: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  const { body } = await apiRoot.customers().post({ body: data }).execute();
  return body; // { customer, cart? }
}

export async function getCustomerById(customerId: string) {
  const { body } = await apiRoot.customers().withId({ ID: customerId }).get().execute();
  return body;
}

export async function updateCustomer(
  customerId: string,
  version: number,
  actions: Array<{ action: string; [key: string]: unknown }>
) {
  const { body } = await apiRoot
    .customers()
    .withId({ ID: customerId })
    .post({ body: { version, actions: actions as CustomerUpdateAction[] } })
    .execute();
  return body;
}

export async function getOrderById(orderId: string) {
  const { body } = await apiRoot.orders().withId({ ID: orderId }).get().execute();
  return body;
}

export async function getCustomerOrders(customerId: string, limit = 20, offset = 0) {
  const { body } = await apiRoot
    .orders()
    .get({
      queryArgs: {
        where: `customerId = "${customerId}"`,
        sort: 'createdAt desc',
        limit,
        offset,
      },
    })
    .execute();
  return body;
}
```

> **`MergeWithExistingCustomerCart`** — When the customer has a pre-existing active cart, CT merges the anonymous cart's line items into it and returns the merged cart. The response `cart` field will be set when a merge occurred. Always read `result.cart?.id` to get the correct post-login `cartId`.

---

## Pattern 2: Login Route Handler

**INCORRECT:** Setting only the customer fields in the session and ignoring `result.cart` — the anonymous cart is lost.

**CORRECT — read `result.cart` to capture the merged cart ID:**

```typescript
// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession, createSessionToken, setSessionCookie } from '@/lib/session';
import { signInCustomer } from '@/lib/ct/auth';
import { getCart, setCartCustomerId } from '@/lib/ct/cart';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
  }

  const session = await getSession();

  try {
    // Pass anonymous cartId so CT can merge it into the customer cart
    const result = await signInCustomer(email, password, session.cartId);
    const customer = result.customer;

    // Use merged cart ID if CT returned one; otherwise keep current cartId
    let cartId = session.cartId;
    if (result.cart) {
      cartId = result.cart.id;
    }

    // Ensure cart has customerId set (may be absent on freshly-merged carts)
    if (cartId) {
      try {
        const cart = await getCart(cartId);
        if (!cart.customerId) {
          const updated = await setCartCustomerId(cartId, cart.version, customer.id);
          cartId = updated.id;
        }
      } catch {
        // Cart may no longer exist — clear it
        cartId = undefined;
      }
    }

    const newSession = {
      ...session,
      customerId: customer.id,
      customerEmail: customer.email,
      customerFirstName: customer.firstName || '',
      customerLastName: customer.lastName || '',
      cartId,
    };

    const token = await createSessionToken(newSession);
    const resp = NextResponse.json({
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
      },
    });
    setSessionCookie(resp, token);
    return resp;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Login failed';
    // CT returns 400 for invalid credentials
    if (msg.includes('400') || msg.includes('Unauthorized') || msg.includes('invalid')) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

---

## Pattern 3: Register and Logout Route Handlers

### Register

```typescript
// app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession, createSessionToken, setSessionCookie } from '@/lib/session';
import { signUpCustomer } from '@/lib/ct/auth';

export async function POST(req: NextRequest) {
  const { email, password, firstName, lastName } = await req.json();

  if (!email || !password || !firstName || !lastName) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 });
  }

  const session = await getSession();

  try {
    const result = await signUpCustomer({ email, password, firstName, lastName });
    const customer = result.customer;

    const newSession = {
      ...session,
      customerId: customer.id,
      customerEmail: customer.email,
      customerFirstName: customer.firstName || '',
      customerLastName: customer.lastName || '',
      // preserve cartId — anonymous cart carries over to the new account
    };

    const token = await createSessionToken(newSession);
    const resp = NextResponse.json({ success: true, customer: { id: customer.id, email: customer.email } });
    setSessionCookie(resp, token);
    return resp;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Registration failed';
    // CT returns 400 when the email is already in use
    if (msg.includes('400') || msg.includes('already exists') || msg.includes('email')) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
```

### Logout

```typescript
// app/api/auth/logout/route.ts
import { NextResponse } from 'next/server';
import { getSession, createSessionToken, setSessionCookie } from '@/lib/session';

export async function POST() {
  const session = await getSession();

  // Keep country/currency/locale — clear customer identity and cart
  const newSession = {
    country: session.country,
    currency: session.currency,
    locale: session.locale,
    // cartId intentionally cleared on logout
  };

  const token = await createSessionToken(newSession);
  const resp = NextResponse.json({ success: true });
  setSessionCookie(resp, token);
  return resp;
}
```

### Account Profile (GET /api/account/profile)

```typescript
// app/api/account/profile/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getCustomerById } from '@/lib/ct/auth';

export async function GET() {
  const session = await getSession();
  if (!session.customerId) {
    return NextResponse.json({ customer: null });
  }
  try {
    const customer = await getCustomerById(session.customerId);
    return NextResponse.json({
      customer: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        version: customer.version,
      },
    });
  } catch {
    return NextResponse.json({ customer: null });
  }
}
```

---

## Pattern 4: useAccount Hook

**INCORRECT:** Reading `customerId` from a cookie or localStorage on the client — this leaks session data and doesn't stay in sync.

**CORRECT — SWR hook backed by `GET /api/account/profile`:**

```typescript
// hooks/useAccount.ts
'use client';

import useSWR from 'swr';
import { KEY_ACCOUNT } from '@/lib/cache-keys';

export interface AccountProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  version?: number;
}

async function accountFetcher(): Promise<AccountProfile | null> {
  const res = await fetch('/api/account/profile');
  if (!res.ok) return null;
  const data = await res.json();
  return data.customer ?? null;
}

export function useAccount() {
  return useSWR<AccountProfile | null>(KEY_ACCOUNT, accountFetcher, {
    revalidateOnFocus: false,
  });
}
```

**Logout from the client** — clear all user-related SWR caches after calling the logout Route Handler:

```typescript
import { mutate } from 'swr';
import { KEY_ACCOUNT, KEY_CART, KEY_WISHLIST } from '@/lib/cache-keys';

async function handleLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  // Immediately clear SWR caches — no refetch needed
  mutate(KEY_ACCOUNT, null, { revalidate: false });
  mutate(KEY_CART, null, { revalidate: false });
  mutate(KEY_WISHLIST, null, { revalidate: false });
  router.push('/');
}
```

> Clear all caches after logout. If only `KEY_ACCOUNT` is cleared, the cart UI may still show the previous customer's cart until the user refreshes.

---

## Pattern 5: Protected Account Layout

**INCORRECT:** Using Next.js middleware to protect account routes — middleware runs on every request and can't read the SWR cache, causing a flash on client-side navigation.

**CORRECT — Client Component layout that redirects when `useAccount` returns `null`:**

```typescript
// app/[locale]/account/layout.tsx
'use client';

import { useEffect } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/routing';
import { useAccount } from '@/hooks/useAccount';
import { mutate } from 'swr';
import { KEY_ACCOUNT, KEY_CART, KEY_WISHLIST } from '@/lib/cache-keys';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: user } = useAccount();

  // Redirect to login when account data resolves to null (not logged in)
  useEffect(() => {
    if (user === null) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
    }
  }, [user, router, pathname]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    mutate(KEY_ACCOUNT, null, { revalidate: false });
    mutate(KEY_CART, null, { revalidate: false });
    mutate(KEY_WISHLIST, null, { revalidate: false });
    router.push('/');
  }

  // user === undefined means still loading — render nothing to avoid flash
  if (!user) return null;

  const navItems = [
    { path: '/account', label: 'Profile', exact: true },
    { path: '/account/orders', label: 'Orders' },
    { path: '/account/addresses', label: 'Addresses' },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 lg:px-8">
      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-10">
        <aside className="mb-8 lg:mb-0">
          <div className="overflow-hidden rounded-sm border border-border bg-white">
            <div className="border-b border-border bg-cream px-5 py-4">
              <p className="text-sm font-semibold text-charcoal">
                {user.firstName} {user.lastName}
              </p>
              <p className="truncate text-xs text-charcoal-light">{user.email}</p>
            </div>
            <nav className="py-2">
              {navItems.map((item) => {
                const isActive = item.exact ? pathname === item.path : pathname.startsWith(item.path);
                return (
                  <Link key={item.path} href={item.path}
                    className={`block px-5 py-2.5 text-sm transition-colors ${
                      isActive ? 'bg-terra/5 font-medium text-terra' : 'text-charcoal-light hover:bg-cream hover:text-charcoal'
                    }`}>
                    {item.label}
                  </Link>
                );
              })}
              <button onClick={handleLogout}
                className="mt-2 w-full border-t border-border px-5 py-2.5 text-left text-sm text-charcoal-light transition-colors hover:bg-cream hover:text-charcoal">
                Logout
              </button>
            </nav>
          </div>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
```

> **`if (!user) return null`** covers both `undefined` (loading) and `null` (not logged in). The `useEffect` handles the redirect for `null` asynchronously — returning `null` prevents a flash of the account layout while the redirect fires.

---

## Checklist

- [ ] `lib/ct/auth.ts` uses `apiRoot.login().post()` — NOT `apiRoot.customers().login()`
- [ ] Login Route Handler reads `result.cart?.id` to capture merged cart after sign-in
- [ ] `anonymousCartSignInMode: 'MergeWithExistingCustomerCart'` is set when `anonymousCartId` is present
- [ ] Logout Route Handler clears `customerId`, `customerEmail`, `customerFirstName`, `customerLastName`, and `cartId` from session
- [ ] `useAccount` uses `KEY_ACCOUNT` from `lib/cache-keys.ts`
- [ ] Client logout mutates `KEY_ACCOUNT`, `KEY_CART`, and `KEY_WISHLIST` caches to `null`
- [ ] Account layout redirects to `/login?redirect=<path>` when `user === null`
- [ ] Account layout renders nothing (`return null`) while user is `undefined` (loading)

**Next:** [performance.md](./performance.md)
