# commercetools Client & Session

**Impact: CRITICAL — This is the foundation. Every other reference depends on `apiRoot`, `getSession`, and the BFF boundary being correctly wired.**

This reference covers the CT SDK singleton, environment setup, JWT session management, and the BFF (Backend-for-Frontend) architecture that prevents credential leaks.

## Table of Contents
- [Pattern 1: SDK Client Singleton](#pattern-1-sdk-client-singleton)
- [Pattern 2: Environment Variables](#pattern-2-environment-variables)
- [Pattern 3: JWT Session Management](#pattern-3-jwt-session-management)
- [Pattern 4: BFF Route Handler Shape](#pattern-4-bff-route-handler-shape)
- [Pattern 5: CT Helper Function Shape](#pattern-5-ct-helper-function-shape)
- [Pattern 6: Connection Health Check](#pattern-6-connection-health-check)
- [Checklist](#checklist)

---

## Pattern 1: SDK Client Singleton

**INCORRECT:** `new ClientBuilder()` inside a page, component, or Route Handler. This creates a new HTTP client (and a new token) per request — memory leak and token exhaustion.

**CORRECT — singleton in `lib/ct/client.ts`, imported everywhere else:**

```typescript
// lib/ct/client.ts
import { createApiBuilderFromCtpClient } from '@commercetools/platform-sdk';
import { ClientBuilder } from '@commercetools/sdk-client-v2';

const projectKey = process.env.CTP_PROJECT_KEY!;
const authUrl = process.env.CTP_AUTH_URL!;
const apiUrl = process.env.CTP_API_URL!;

function buildClient() {
  return new ClientBuilder()
    .withProjectKey(projectKey)
    .withClientCredentialsFlow({
      host: authUrl,
      projectKey,
      credentials: {
        clientId: process.env.CTP_CLIENT_ID!,
        clientSecret: process.env.CTP_CLIENT_SECRET!,
      },
      scopes: [process.env.CTP_SCOPES!],
    })
    .withHttpMiddleware({ host: apiUrl })
    .build();
}

export const apiRoot = createApiBuilderFromCtpClient(buildClient())
  .withProjectKey({ projectKey });

export { projectKey, apiUrl, authUrl };
```

The SDK's `ClientBuilder` with `withClientCredentialsFlow` handles OAuth 2.0 token fetching and auto-refresh transparently.

---

## Pattern 2: Environment Variables

**INCORRECT:** `NEXT_PUBLIC_CTP_CLIENT_SECRET` — exposes the secret in the browser bundle.

**CORRECT — all CT and session variables are server-only (no `NEXT_PUBLIC_` prefix):**

`site/.env`:
```bash
CTP_PROJECT_KEY=your-project-key
CTP_AUTH_URL=https://auth.us-central1.gcp.commercetools.com
CTP_API_URL=https://api.us-central1.gcp.commercetools.com
CTP_CLIENT_ID=your-client-id
CTP_CLIENT_SECRET=your-client-secret
CTP_SCOPES=view_products:key view_categories:key manage_my_orders:key manage_my_profile:key manage_my_shopping_lists:key manage_payments:key manage_orders:key manage_carts:key
SESSION_SECRET=minimum-32-character-random-string
```

**Auth URL by region:**
- Americas: `https://auth.us-central1.gcp.commercetools.com`
- Europe: `https://auth.europe-west1.gcp.commercetools.com`
- Australia: `https://auth.australia-southeast1.gcp.commercetools.com`

**Required API client scopes (Merchant Center → Settings → Developer Settings):**
Use the **Mobile & single-page application** template, then add `manage_payments` and `manage_orders`.

Add `site/.env` to `.gitignore`. Never commit it.

---

## Pattern 3: JWT Session Management

**INCORRECT:** Storing `cartId` or `customerId` in localStorage — accessible to XSS attacks. Or using server-side session storage — requires infrastructure.

**CORRECT — HTTP-only cookie signed with HS256 JWT (server-only `jose` library):**

`lib/session.ts`:
```typescript
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { COUNTRY_CONFIG, DEFAULT_LOCALE } from '@/lib/utils';

const SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'dev-only-fallback-32-char-key!!'
);
const COOKIE_NAME = 'vibe-session';

export interface Session {
  customerId?: string;
  customerEmail?: string;
  customerFirstName?: string;
  customerLastName?: string;
  cartId?: string;
  country?: string;
  currency?: string;
  locale?: string;
}

export async function getSession(): Promise<Session> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return {};
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const { iat, exp, ...session } = payload as Session & { iat?: number; exp?: number };
    return session;
  } catch {
    return {};
  }
}

export async function getLocale(): Promise<{ country: string; currency: string; locale: string }> {
  const session = await getSession();
  if (session.country && session.currency && session.locale) {
    return { country: session.country, currency: session.currency, locale: session.locale };
  }
  const cookieStore = await cookies();
  const country = cookieStore.get('vibe-country')?.value || DEFAULT_LOCALE.country;
  const config = COUNTRY_CONFIG[country] || COUNTRY_CONFIG[DEFAULT_LOCALE.country];
  return { country, currency: config.currency, locale: config.locale };
}

export async function createSessionToken(data: Session): Promise<string> {
  return new SignJWT(data as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(SECRET);
}

export function setSessionCookie(response: NextResponse, token: string): NextResponse {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
  });
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, sameSite: 'lax', maxAge: 0, path: '/' });
  return response;
}
```

**Session fields:**

| Field | Set when | Cleared when |
|-------|----------|-------------|
| `customerId` | Login/register | Logout |
| `cartId` | Cart created or login | Order placed |
| `country/currency/locale` | Country selector | Never (persists) |

---

## Pattern 4: BFF Route Handler Shape

**INCORRECT:** Calling `lib/ct/*` directly from a Client Component or SWR fetcher.

**CORRECT — every CT call goes through a Route Handler:**

```
Browser component
  → SWR hook (hooks/*.ts)        — 'use client', calls fetch('/api/...')
  → Route Handler (app/api/...)  — server-only, calls lib/ct/*
  → lib/ct/<namespace>.ts        — server-only, calls apiRoot
  → commercetools API
```

Typical Route Handler:
```typescript
// app/api/<resource>/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { someCTFunction } from '@/lib/ct/<namespace>';

export async function GET(_req: NextRequest) {
  const session = await getSession();
  // Use session.customerId, session.cartId, etc.
  const data = await someCTFunction(/* args */);
  return NextResponse.json({ data });
}
```

---

## Pattern 5: CT Helper Function Shape

**INCORRECT:** Inlining `apiRoot.carts().withId()...execute()` directly in a Route Handler.

**CORRECT — one function per operation, all in the matching `lib/ct/` file:**

```typescript
// lib/ct/<namespace>.ts
import { apiRoot } from './client';

export async function getThings(id: string) {
  // Destructure body from the SDK response — every .execute() returns { body, statusCode, headers }
  const { body } = await apiRoot.things().withId({ ID: id }).get().execute();
  return body;
}
```

**CT namespace files:**

| File | Owns |
|------|------|
| `lib/ct/client.ts` | `apiRoot` singleton |
| `lib/ct/auth.ts` | `signInCustomer`, `signUpCustomer`, `getCustomerById`, `updateCustomer` |
| `lib/ct/cart.ts` | All cart + order operations |
| `lib/ct/categories.ts` | `getCategoryBySlug`, `getCategoryTree` |
| `lib/ct/search.ts` | `searchProducts`, `getProductBySku` |

---

## Pattern 6: Connection Health Check

After wiring up the client, verify credentials with a one-off health route. **Delete it before deploying.**

```typescript
// app/api/health/route.ts  ← DELETE before deploying
import { NextResponse } from 'next/server';
import { apiRoot } from '@/lib/ct/client';

export async function GET() {
  try {
    const { body } = await apiRoot.get().execute();
    return NextResponse.json({ ok: true, projectKey: body.key });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
```

```bash
curl http://localhost:8888/api/health
# → {"ok":true,"projectKey":"your-project-key"}
```

---

## Checklist

- [ ] `lib/ct/client.ts` exports a single `apiRoot` — no `new ClientBuilder()` elsewhere
- [ ] `site/.env` has all 7 variables; file is gitignored
- [ ] No CT env vars are prefixed with `NEXT_PUBLIC_`
- [ ] `lib/session.ts` exports `getSession`, `createSessionToken`, `setSessionCookie`, `clearSessionCookie`
- [ ] `SESSION_SECRET` is at least 32 characters in production
- [ ] Health check returns `{"ok":true}` with your project key

**Next:** [product-listing.md](./product-listing.md)
