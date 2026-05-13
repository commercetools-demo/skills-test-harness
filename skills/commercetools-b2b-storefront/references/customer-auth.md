# Customer Authentication

**Impact: HIGH — The login endpoint is `apiRoot.login().post()`, not `customers().login()`. Missing BU auto-selection at login leaves the user without a business unit context and breaks all B2B operations.**

This reference covers the CT login endpoint, BU auto-selection at login, how all session fields are initialized, and the `AuthContext` / `useAccount` hook.

## Table of Contents
- [Pattern 1: CT Login Endpoint and BU Auto-Selection](#pattern-1-ct-login-endpoint-and-bu-auto-selection)
- [Pattern 2: Session Fields Written at Login](#pattern-2-session-fields-written-at-login)
- [Pattern 3: Auth Context and useAccount Hook](#pattern-3-auth-context-and-useaccount-hook)
- [Pattern 4: Logout — Clearing Session and SWR Cache](#pattern-4-logout--clearing-session-and-swr-cache)
- [Checklist](#checklist)

---

## Pattern 1: CT Login Endpoint and BU Auto-Selection

**INCORRECT:** Using `apiRoot.customers().login()` (does not exist in CT SDK v2) or skipping BU resolution:

```typescript
// WRONG — wrong endpoint; no BU context after login
const { body } = await apiRoot.customers().login().post({ body: { email, password } }).execute();
```

**CORRECT — `apiRoot.login().post()` followed immediately by BU and store resolution:**

```typescript
// lib/ct/auth.ts
export async function loginCustomer(email: string, password: string) {
  const { body } = await apiRoot.login().post({ body: { email, password } }).execute();
  return body.customer;
}

// app/api/auth/login/route.ts
export async function POST(request: NextRequest) {
  const { email, password } = await request.json();
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const customer = await loginCustomer(email, password);

  // Fetch all BUs the customer is an associate of
  const businessUnits = await getBusinessUnitsForAssociate(customer.id);

  // Auto-select first BU + first store
  const firstBU = businessUnits[0];
  const firstStore = firstBU?.stores?.[0];

  let storeSession = {};
  if (firstBU && firstStore) {
    // Resolve distributionChannelId, supplyChannelId, productSelectionId from the store
    const channelData = await getStoreChannelData(firstStore.key);
    storeSession = {
      businessUnitKey: firstBU.key,
      storeKey: firstStore.key,
      ...channelData, // supplyChannelId, distributionChannelId, productSelectionId
    };
  }

  const response = NextResponse.json({ customer, businessUnits });
  await setSession(response, {
    customerId: customer.id,
    customerEmail: customer.email,
    customerFirstName: customer.firstName,
    customerLastName: customer.lastName,
    ...storeSession,
    // locale/currency/country preserved from existing session if present
  });

  return response;
}
```

> `getBusinessUnitsForAssociate` calls `apiRoot.businessUnits().get({ where: 'associates(customer(id="..."))' })`. This is a project-level call — BU discovery does not require as-associate scoping. All subsequent operations use the as-associate chain with the selected `businessUnitKey`.

---

## Pattern 2: Session Fields Written at Login

**INCORRECT:** Omitting B2B fields from the session after login:

```typescript
// WRONG — user logged in but no BU context; all B2B operations will fail
await setSession(response, {
  customerId: customer.id,
  customerEmail: customer.email,
});
```

**CORRECT — all session fields set in one atomic call:**

```typescript
await setSession(response, {
  // Auth
  customerId: customer.id,
  customerEmail: customer.email,
  customerFirstName: customer.firstName,
  customerLastName: customer.lastName,

  // B2B context — from first BU's first store
  businessUnitKey: firstBU.key,         // e.g. 'acme-eu'
  storeKey: firstStore.key,             // e.g. 'acme-eu-de'
  storeId: channelData.storeId,         // UUID — used for category filtering
  distributionChannelId: channelData.distributionChannelId,  // for price scoping
  supplyChannelId: channelData.supplyChannelId,              // for inventory display
  productSelectionId: channelData.productSelectionId,        // for product visibility

  // Locale — either from prior session or derived from store's default
  locale: session.locale ?? DEFAULT_LOCALE.backendLocale,
  urlLocale: session.urlLocale ?? DEFAULT_LOCALE.urlLocale,
  currency: session.currency ?? DEFAULT_CURRENCY,
  country: session.country ?? DEFAULT_COUNTRY,
});
```

---

## Pattern 3: Auth Context and useAccount Hook

**INCORRECT:** Storing auth state in `localStorage` or re-fetching from CT on every render:

```typescript
// WRONG — not reactive, not server-safe
const customerId = localStorage.getItem('customerId');
```

**CORRECT — `AuthContext` backed by `GET /api/auth/me`, SWR-cached:**

```typescript
// context/AuthContext.tsx (key excerpts)
'use client';

export function AuthProvider({ children }) {
  const { data, isLoading, mutate } = useSWR(KEY_AUTH_ME, meFetcher, {
    revalidateOnFocus: false,
  });

  const user = data?.customer ?? null;
  const isLoggedIn = !!user;

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, loading: isLoading, mutate }}>
      {children}
    </AuthContext.Provider>
  );
}

// hooks/useAccount.ts — lower-level hook
export function useAccount() {
  return useSWR<Account | null>(KEY_AUTH_ME, meFetcher, { revalidateOnFocus: false });
}
```

```typescript
// app/api/auth/me/route.ts
export async function GET() {
  const session = await getSession();
  if (!session.customerId) return NextResponse.json({ customer: null });
  try {
    const customer = await getCustomerById(session.customerId);
    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json({ customer: null });
  }
}
```

---

## Pattern 4: Logout — Clearing Session and SWR Cache

**INCORRECT:** Clearing only the auth cache after logout:

```typescript
// WRONG — cart and BU data still visible until next page load
await fetch('/api/auth/logout', { method: 'POST' });
mutate(KEY_AUTH_ME, null, { revalidate: false });
```

**CORRECT — clear all user-related SWR caches and reset BU context:**

```typescript
// hooks/useAuthApi.ts
export async function logoutRequest() {
  const res = await fetch('/api/auth/logout', { method: 'POST' });
  if (!res.ok) throw new Error('Logout failed');
}

// In the component or layout calling logout:
import { mutate } from 'swr';
import { KEY_AUTH_ME, KEY_CART, KEY_BUSINESS_UNITS } from '@/lib/cache-keys';

async function handleLogout() {
  await logoutRequest();
  // Clear all user-scoped SWR caches
  mutate(KEY_AUTH_ME, null, { revalidate: false });
  mutate(KEY_CART, null, { revalidate: false });
  mutate(KEY_BUSINESS_UNITS, { businessUnits: [] }, false);
  // BusinessUnitContext resets itself via its useEffect on isLoggedIn change
  router.push('/login');
}
```

```typescript
// app/api/auth/logout/route.ts
export async function POST() {
  const session = await getSession();
  const response = NextResponse.json({ success: true });
  // Keep locale/currency/country — clear all user and BU fields
  await setSession(response, {
    locale: session.locale,
    urlLocale: session.urlLocale,
    currency: session.currency,
    country: session.country,
    // cartId, customerId, businessUnitKey, storeKey, channels all cleared (omitted)
  });
  return response;
}
```

---

## Checklist

- [ ] `loginCustomer` uses `apiRoot.login().post()` — NOT `customers().login()`
- [ ] Login Route Handler calls `getBusinessUnitsForAssociate(customer.id)` immediately after login
- [ ] First BU's first store is auto-selected and `getStoreChannelData(storeKey)` called
- [ ] All B2B session fields written in one `setSession()` call at login
- [ ] `AuthContext` backed by `GET /api/auth/me` + SWR with `revalidateOnFocus: false`
- [ ] Logout clears `KEY_AUTH_ME`, `KEY_CART`, and `KEY_BUSINESS_UNITS` SWR caches
- [ ] Logout Route Handler preserves `locale`, `urlLocale`, `currency`, `country`
