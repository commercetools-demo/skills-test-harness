# Checkout

Two checkout flows: **cart → order** and **quote → order**.

## Flow 1: Cart Checkout

**Page:** `app/[locale]/checkout/page.tsx` (`'use client'`)

**Steps:**
1. User fills shipping address (or selects a saved address from their CT customer account)
2. Optionally fills a separate billing address
3. Optionally enters a PO Number
4. Submits → `POST /api/checkout`

### Route Handler — `POST /api/checkout`

```typescript
// app/api/checkout/route.ts
export async function POST(request: NextRequest) {
  const session = await getSession();

  if (!session?.customerId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!session.cartId || !session.businessUnitKey || !session.storeKey) {
    return NextResponse.json({ error: 'No active cart' }, { status: 400 });
  }

  const { shippingAddress, billingAddress, purchaseOrderNumber } = await request.json();

  // 1. Fetch current cart
  let cart = await getCartById(session.cartId, session.customerId, session.businessUnitKey, session.storeKey, session.locale);

  // 2. Set shipping address (required by CT before order creation)
  cart = await setShippingAddress(session.cartId, cart.version, shippingAddress, session.customerId, session.businessUnitKey, session.storeKey, session.locale);

  // 3. Set billing address (defaults to shipping if not provided)
  cart = await setBillingAddress(session.cartId, cart.version, billingAddress || shippingAddress, session.customerId, session.businessUnitKey, session.storeKey, session.locale);

  // 4. Create order from cart
  const order = await createOrderFromCart(session.cartId, cart.version, session.customerId, session.businessUnitKey);

  // 5. Clear cartId from session — cart is consumed
  const response = NextResponse.json({ order }, { status: 201 });
  await setSession(response, { ...session, cartId: undefined });
  return response;
}
```

**Key rules:**
- CT requires a shipping address on the cart before order creation
- `createOrderFromCart` uses the as-associate chain — not project-level `apiRoot`
- After order creation, clear `session.cartId` — the cart is consumed
- If the order triggers an approval rule, CT creates an `ApprovalFlow` automatically; the API still returns status 201

### CT Helper — `createOrderFromCart`

```typescript
// lib/ct/orders.ts
export async function createOrderFromCart(
  cartId: string, version: number,
  associateId: string, businessUnitKey: string
): Promise<Order> {
  const { body } = await apiRoot
    .asAssociate()
    .withAssociateIdValue({ associateId })
    .inBusinessUnitKeyWithBusinessUnitKeyValue({ businessUnitKey })
    .orders()
    .post({ body: { cart: { id: cartId, typeId: 'cart' }, version } })
    .execute();
  return mapOrder(body);
}
```

### Saved Addresses

The checkout page reads saved addresses from `useAccount()` (SWR hook). It auto-selects `isDefaultShipping` / `isDefaultBilling` addresses on load. The user may override by selecting another saved address or entering a new one manually.

---

## Flow 2: Quote Checkout

**Page:** `app/[locale]/checkout-quote/page.tsx` (`'use client'`)

Navigate to this page with `?quoteId=<id>` after a quote is approved.

**Steps:**
1. Load quote by `quoteId` via `quoteFetcher(quoteId)` (direct fetch in component via `useEffect` — this page is not BU-scoped)
2. Check `quote.quoteState === 'Pending' || 'RenegotiationAddressed'` — only then allow acceptance
3. User clicks **Accept & Place Order**:
   - `acceptQuoteRequest(quoteId, quote.version)` → transitions quote to `Accepted`
   - `createOrderFromQuoteRequest(quoteId, acceptedQuote.version)` → creates the order
4. Redirect to confirmation page

```typescript
// hooks/useQuotesApi.ts
export async function acceptQuoteRequest(quoteId: string, version: number) {
  const res = await fetch(`/api/quotes/${quoteId}/accept`, { method: 'POST', body: JSON.stringify({ version }) });
  if (!res.ok) throw new Error('Failed to accept quote');
  return res.json();
}

export async function createOrderFromQuoteRequest(quoteId: string, version: number) {
  const res = await fetch(`/api/quotes/${quoteId}/order`, { method: 'POST', body: JSON.stringify({ version }) });
  if (!res.ok) throw new Error('Failed to create order from quote');
  return res.json();
}
```

**Why two steps:** CT requires the quote to be explicitly `Accepted` before an order can be created from it. The accept + create-order calls must happen sequentially — use the returned `acceptedQuote.version` for the order creation call.

---

## Order Confirmation

**Page:** `app/[locale]/checkout/confirmation/page.tsx`

Both flows redirect to `/checkout/confirmation?orderId=<id>`. The confirmation page reads the order by ID.

---

## PO Number

The checkout form includes an optional PO Number field (`purchaseOrderNumber`). This is stored on the CT order as a custom field or `purchaseOrderNumber` field depending on your CT configuration. The Route Handler passes it through to `createOrderFromCart` body if provided:

```typescript
const order = await createOrderFromCart(session.cartId, cart.version, session.customerId, session.businessUnitKey, purchaseOrderNumber);
```

---

## Checklist

- [ ] Shipping address set on cart before order creation (CT requirement)
- [ ] `createOrderFromCart` uses as-associate chain — not project-level `apiRoot`
- [ ] `session.cartId` cleared after successful order creation
- [ ] Quote checkout: accept first (`Pending`/`RenegotiationAddressed`), then create order with accepted version
- [ ] Redirect to `/checkout/confirmation?orderId=<id>` on success
