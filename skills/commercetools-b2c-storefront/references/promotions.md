# Promotions & Discounts

**Impact: LOW — Three discount types in CT each surface differently. Product discounts require search query expansion to show names. Cart discounts reduce totals silently.**

## Table of Contents
- [Pattern 1: Discount Types Overview](#pattern-1-discount-types-overview)
- [Pattern 2: Product Discount Display](#pattern-2-product-discount-display)
- [Pattern 3: Discount Code Form](#pattern-3-discount-code-form)
- [Pattern 4: Promotion Banner](#pattern-4-promotion-banner)

---

## Pattern 1: Discount Types Overview

| Type | How it works | Where it surfaces |
|---|---|---|
| **Product Discount** | Changes `variant.price.discounted` on matching products | Badge + strikethrough on `ProductCard` and `PDPPrice` |
| **Cart Discount** | Reduces `lineItem.totalPrice` and/or `cart.totalPrice` silently | Line item price difference, cart total reduction |
| **Discount Code** | Customer-entered code that triggers a Cart Discount | Applied chip in cart, `cart.discountCodes[]` |

All three are created in CT Merchant Center under **Discounts**.

---

## Pattern 2: Product Discount Display

**INCORRECT:** not expanding the discount reference — `discountName` is `undefined`.

```typescript
// BAD — discount ref not expanded
const productProjectionParameters = {
  body: {
    // No expand — variant.price.discounted.discount is just { id: '...' }
  },
};
// In component: product.price.discounted?.discountName → undefined
```

**CORRECT — expand both `masterVariant` and `variants` discount references:**

```typescript
// site/lib/ct/products.ts
const productProjectionParameters = {
  body: {
    query: { ... },
    productProjectionParameters: {
      expand: [
        'masterVariant.price.discounted.discount',
        'variants[*].price.discounted.discount',
      ],
    },
  },
};
```

```typescript
// site/lib/mappers/product-mapper.ts
function mapPrice(ctPrice: CtPrice): Price {
  return {
    value:     mapMoney(ctPrice.value),
    discounted: ctPrice.discounted
      ? {
          value:        mapMoney(ctPrice.discounted.value),
          discountName: (ctPrice.discounted.discount?.obj as any)?.name?.['en-US'],
        }
      : undefined,
  };
}
```

```typescript
// site/components/product/ProductCard.tsx
{product.price.discounted && (
  <>
    <span className="line-through text-gray-400">{formatMoney(product.price.value)}</span>
    <span className="text-red-600">{formatMoney(product.price.discounted.value)}</span>
    {product.price.discounted.discountName && (
      <span className="rounded bg-red-100 px-1 text-xs text-red-700">
        {product.price.discounted.discountName}
      </span>
    )}
  </>
)}
```

---

## Pattern 3: Discount Code Form

Already implemented — import `<DiscountCodeForm />` wherever needed. Do not write a custom fetch.

```typescript
// site/components/cart/DiscountCodeForm.tsx  (already exists)
// Reads and mutates KEY_CART automatically via useSWR.
// POST /api/cart/discount  { code: string }
// DELETE /api/cart/discount  { code: string }
```

Usage in cart page:

```typescript
import DiscountCodeForm from '@/components/cart/DiscountCodeForm';

// Inside CartPage or CartDrawer:
<DiscountCodeForm />
```

The form:
- Shows an input for entering a code
- On submit: calls `POST /api/cart/discount`, revalidates cart SWR key
- Shows applied codes as chips with a remove button (calls `DELETE /api/cart/discount`)
- Displays CT error messages (e.g. "Code not found", "Already applied")

Route handlers (already exist):

```typescript
// site/app/api/cart/discount/route.ts

// POST — apply code
export async function POST(request: Request) {
  const { code } = await request.json();
  const cart = await applyCartAction(session.cartId!, session.customerId, [
    { action: 'addDiscountCode', code },
  ]);
  return NextResponse.json(mapCart(cart));
}

// DELETE — remove code
export async function DELETE(request: Request) {
  const { code } = await request.json();
  const cart = await applyCartAction(session.cartId!, session.customerId, [
    { action: 'removeDiscountCode', discountCode: { typeId: 'discount-code', id: codeId } },
  ]);
  return NextResponse.json(mapCart(cart));
}
```

---

## Pattern 4: Promotion Banner

Two options — choose one:

**Option A: Static banner in `Header.tsx`:**

```typescript
// site/components/layout/Header.tsx
export default function Header() {
  return (
    <>
      {/* Promotion banner — hardcoded or from environment variable */}
      <div className="bg-sage-100 py-2 text-center text-sm font-medium">
        Free shipping on orders over $50 — Use code FREESHIP
      </div>
      {/* rest of header */}
    </>
  );
}
```

**Option B: CMS-driven via `content/message` section in `lib/layout.ts`:**

```typescript
// site/lib/layout.ts  (inside getHomeSections)
{
  type: 'content/message',
  config: {
    text: {
      'en-US': 'Free shipping on orders over $50 — Use code FREESHIP',
      'de-DE': 'Kostenloser Versand ab 50 € — Code: FREESHIP',
    },
  },
  size: { xs: 12 },
  background: 'Sage',
},
```

```typescript
// site/components/home/MessageBanner.tsx
import type { ItemProps } from '@/lib/layout';

interface MessageBannerProps { text: string }

export default function MessageBanner({ config }: ItemProps<MessageBannerProps>) {
  return (
    <div className="py-2 text-center text-sm font-medium">
      {config.text}
    </div>
  );
}
```

Then register `'content/message': dynamic(() => import('../home/MessageBanner'))` in `Item.tsx`.

---

## Checklist
- [ ] When showing discount badge/name: expand `masterVariant.price.discounted.discount` and `variants[*].price.discounted.discount` in search params
- [ ] `DiscountCodeForm` imported (not custom fetch) wherever discount codes are entered
- [ ] CT Merchant Center: Product Discount created and active (if using product-level discounts)
- [ ] CT Merchant Center: Cart Discount created and active (if using cart-level discounts)
- [ ] CT Merchant Center: Discount Code created and linked to a Cart Discount (if using codes)
- [ ] Promotion banner added via Header (static) or layout sections (CMS-driven)
