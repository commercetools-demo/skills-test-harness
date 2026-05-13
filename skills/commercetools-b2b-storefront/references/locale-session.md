# Locale / Currency / Country Session Pattern

**Impact: HIGH — All four locale fields must be written atomically. Changing locale or currency without clearing `cartId` leaves the cart in the wrong currency (immutable in CT).**

## Four Session Fields — Always Write Together

| Session field | Example | Description |
|---|---|---|
| `locale` | `'de-DE'` | CT backend BCP-47 — sent to all CT API calls |
| `urlLocale` | `'de-ch'` | URL path locale key — drives Next.js routing |
| `currency` | `'CHF'` | ISO 4217 — for cart creation and price display |
| `country` | `'CH'` | ISO 3166-1 alpha-2 — for CT price/availability filtering |

**`locale` vs `urlLocale`:** For Switzerland, the URL uses `de-ch` but CT products are only localised in `de-DE`. `session.locale = 'de-DE'` (CT backend); `session.urlLocale = 'de-ch'` (URL). All CT API calls use `session.locale`. Routing uses `session.urlLocale`.

## Source of Truth — `LOCALE_CONFIG` in `lib/utils.ts`

```typescript
export const LOCALE_CONFIG: Record<string, CountryConfig> = {
  DE: {
    flag: '🇩🇪',
    name: 'Germany',
    currencies: ['EUR', 'GBP'],
    languages: {
      de: { backendLocale: 'de-DE', name: 'Deutsch' },
      en: { backendLocale: 'en-GB', name: 'English' },
    },
  },
  CH: {
    flag: '🇨🇭',
    name: 'Switzerland',
    currencies: ['CHF'],
    languages: {
      de: { backendLocale: 'de-DE', name: 'Deutsch' },   // backendLocale differs from urlLocale
      fr: { backendLocale: 'fr-FR', name: 'Français' },
    },
  },
};
```

URL locale is derived as `${language}-${country.toLowerCase()}` → `de-ch`.

## Where Session Locale Fields Are Written

### Language switch — `POST /api/session/locale`

```typescript
const entry = getLocaleEntry(locale); // locale = URL key from client, e.g. 'de-ch'
await setSession(response, {
  ...session,
  locale: entry.backendLocale,    // CT locale, e.g. 'de-DE'
  urlLocale: entry.urlLocale,     // URL key, e.g. 'de-ch'
  currency: entry.currencies[0], // default currency for this locale
  country: entry.country,        // ISO 3166-1, e.g. 'CH'
  cartId: undefined,             // ← always clear on locale change; CT cart currency is immutable
});
```

### Currency switch — `POST /api/session/currency`

```typescript
// Only updates currency and clears cartId
await setSession(response, {
  ...session,
  currency: newCurrency,
  cartId: undefined,  // ← clear on currency change
});
```

## CT-Backed Validation — `getValidLocaleData()`

`lib/ct/locale-validation.ts` exports `getValidLocaleData()`:
1. Fetches `GET /{projectKey}` on the CT project
2. Filters out `LOCALE_CONFIG` entries whose country code, currency, or `backendLocale` is not in the CT project
3. Cached via `unstable_cache` with 5-minute revalidation

The locale dropdown in the header only shows locales that CT supports. **If you add a country to `LOCALE_CONFIG` but haven't set it up in CT yet, it simply won't appear in the dropdown.**

`instrumentation.ts` warms this cache at server startup so the first request doesn't pay the CT round-trip.

## Rules

1. **Always write all four fields together** — `POST /api/session/locale` is the only place that sets them atomically.
2. **`session.locale` = CT backend locale** — never store the display locale there.
3. **Reset `cartId` on locale or currency change** — CT cart currency is immutable.
4. **The URL locale is authoritative for the current request** — the layout always uses `getLocaleEntry(urlParam)`, not the session locale, for display formatting.
5. **No middleware** — use proxy API routes. Do not create `middleware.ts`.

## Checklist

- [ ] `POST /api/session/locale` writes all four fields + clears `cartId`
- [ ] `POST /api/session/currency` updates only `currency` + clears `cartId`
- [ ] CT API calls use `session.locale` (backend locale), not `session.urlLocale`
- [ ] Layout uses `getLocaleEntry(urlParam).frontendLocale` for Intl formatting
- [ ] `LOCALE_CONFIG` is the only place to define countries and languages
