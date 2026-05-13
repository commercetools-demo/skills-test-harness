# Add Country / Locale

**Impact: MEDIUM — Adding country config in multiple places instead of the single source causes missing currencies in cart and broken locale routing.**

All locale data derives from one `COUNTRY_CONFIG` object. Update it once, then add a messages file, routing entry, and hero config.

## Table of Contents
- [Pattern 1: Single Source of Truth](#pattern-1-single-source-of-truth)
- [Pattern 2: Routing Update](#pattern-2-routing-update)
- [Pattern 3: Message File](#pattern-3-message-file)
- [Pattern 4: Hero Config](#pattern-4-hero-config)

---

## Pattern 1: Single Source of Truth

**INCORRECT:** hardcoding currency or locale in multiple files.

```typescript
// BAD — scattered across files
// In cart.ts:
currency: 'EUR'
// In checkout.ts:
country: 'DE'
// In Header.tsx:
const locales = ['en-us', 'de-de'];
```

**CORRECT — add to `COUNTRY_CONFIG` in `lib/utils.ts` only:**

```typescript
// site/lib/utils.ts
export const COUNTRY_CONFIG: Record<string, CountryConfig> = {
  'en-us': {
    locale:    'en-US',       // CT locale string (language tag)
    currency:  'USD',         // ISO 4217
    country:   'US',          // ISO 3166-1 alpha-2
    language:  'en',
    label:     'United States',
    flag:      '🇺🇸',
  },
  'de-de': {
    locale:    'de-DE',
    currency:  'EUR',
    country:   'DE',
    language:  'de',
    label:     'Germany',
    flag:      '🇩🇪',
  },

  // ADD NEW COUNTRY HERE:
  'fr-fr': {
    locale:    'fr-FR',
    currency:  'EUR',
    country:   'FR',
    language:  'fr',
    label:     'France',
    flag:      '🇫🇷',
  },
};
```

The `locale` value is used directly in CT search queries (`language: locale`). The `currency` is used when creating carts. Everything else derives from this map — no other files need direct currency/country hardcoding.

---

## Pattern 2: Routing Update

**INCORRECT:** forgetting to add the URL locale to `i18n/routing.ts`.

```typescript
// BAD — fr-fr missing from locales
export const routing = defineRouting({
  locales: ['en-us', 'de-de'],
  defaultLocale: 'en-us',
});
```

**CORRECT — add lowercase-hyphen URL locale to the `locales` array:**

```typescript
// site/i18n/routing.ts
import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en-us', 'de-de', 'fr-fr'],   // ← add new locale
  defaultLocale: 'en-us',
});
```

> The URL locale format is always **lowercase with hyphen** (e.g. `fr-fr`), matching the key in `COUNTRY_CONFIG`. The `locale` field inside `COUNTRY_CONFIG` uses the proper BCP-47 form (`fr-FR`) for API calls.

---

## Pattern 3: Message File

**INCORRECT:** reusing an existing locale file or naming it incorrectly.

```
// BAD — wrong filename, won't be picked up by next-intl
messages/fr.json
messages/FR.json
```

**CORRECT — create `messages/<url-locale>.json` matching the key in `COUNTRY_CONFIG`:**

```bash
# Copy the closest existing locale as a starting point
cp site/messages/de-de.json site/messages/fr-fr.json
```

Then translate all values in `fr-fr.json`. The filename **must** exactly match the URL locale key (e.g. `fr-fr.json` for the `'fr-fr'` entry).

```json
// site/messages/fr-fr.json (excerpt)
{
  "common": {
    "addToCart": "Ajouter au panier",
    "checkout":  "Passer à la caisse",
    "search":    "Rechercher"
  },
  "cart": {
    "empty":     "Votre panier est vide",
    "subtotal":  "Sous-total"
  }
}
```

---

## Pattern 4: Hero Config

All text fields in `site/config/hero.json` are locale maps. Add entries for each new locale key:

```json
// site/config/hero.json (excerpt — add fr-fr entries)
{
  "home": {
    "title": {
      "en-US": "New Season Arrivals",
      "de-DE": "Neue Saison Ankünfte",
      "fr-FR": "Nouvelles Arrivées de Saison"
    },
    "subtitle": {
      "en-US": "Discover the latest looks",
      "de-DE": "Entdecke die neuesten Styles",
      "fr-FR": "Découvrez les dernières tendances"
    },
    "ctaLabel": {
      "en-US": "Shop Now",
      "de-DE": "Jetzt shoppen",
      "fr-FR": "Acheter maintenant"
    }
  }
}
```

> The locale key in `hero.json` uses the `locale` format from `COUNTRY_CONFIG` (BCP-47: `fr-FR`), not the URL format (`fr-fr`).

---

## Checklist
- [ ] New entry added to `COUNTRY_CONFIG` in `site/lib/utils.ts` with `locale`, `currency`, `country`, `language`, `label`
- [ ] URL locale added to `locales` array in `site/i18n/routing.ts`
- [ ] `site/messages/<url-locale>.json` created with all translation keys
- [ ] `site/config/hero.json` updated with BCP-47 locale key entries for all text fields
- [ ] CT Merchant Center: prices defined for the new currency in the product catalogue
- [ ] CT Merchant Center: shipping zones/methods set up for the new country
