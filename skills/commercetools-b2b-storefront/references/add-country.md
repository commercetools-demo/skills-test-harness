# Adding a New Country / Locale

**Single source of truth: `LOCALE_CONFIG` in `lib/utils.ts`.**

Everything else (routing, CT API locale, currency switcher, language selector, locale validation) derives from it automatically.

## Step 1 — Add entry to `LOCALE_CONFIG`

```typescript
// lib/utils.ts
export const LOCALE_CONFIG: Record<string, CountryConfig> = {
  FR: {
    flag: '🇫🇷',
    name: 'France',
    currencies: ['EUR'],
    languages: {
      fr: { backendLocale: 'fr-FR', name: 'Français' },
    },
  },
};
```

The URL locale is derived automatically: `${language}-${country.toLowerCase()}` → `fr-fr`.

**`backendLocale`** is the BCP-47 locale sent to CT. It differs from the URL locale when CT products are not localised in the country variant (e.g. Switzerland uses URL `de-ch` but CT locale `de-DE`).

**Multiple languages per country** — add more keys to `languages`:

```typescript
CH: {
  currencies: ['CHF', 'EUR'],   // multiple = currency switcher shown in header
  languages: {
    de: { backendLocale: 'de-DE', name: 'Deutsch' },
    fr: { backendLocale: 'fr-FR', name: 'Français' },
  },
},
```

## Step 2 — Add message files

Translation files in `messages/`. Fallback chain for URL locale `fr-fr`:
1. `messages/fr-fr.json` — exact match
2. `messages/fr.json` — language fallback
3. `messages/en.json` — English fallback (always present)

Copy `en.json` as a starting point and translate. If the country shares a language with an existing locale (e.g. `de-ch` → reuse `de.json`), no new file is needed.

## Step 3 — Configure CT project

In CT Merchant Center:
- Add the country code, currency, and language under **Project Settings → Localization**
- Create or identify a store for this country
- Add prices in the new currency for the store's distribution channel
- Ensure product data has `backendLocale` translations

## Step 4 — CT Validation (automatic)

`getValidLocaleData()` in `lib/ct/locale-validation.ts` filters out any `LOCALE_CONFIG` entry not configured in CT. **If you add a country to `LOCALE_CONFIG` but haven't set it up in CT, it simply won't appear in the dropdown** — no crash, a `console.warn`.

## Checklist

- [ ] Entry added to `LOCALE_CONFIG` in `lib/utils.ts`
- [ ] `messages/<urlLocale>.json` added (or language fallback file exists)
- [ ] CT project configured: country, currency, language, store, prices
- [ ] CT products have `backendLocale` translations
- [ ] Smoke test: navigate to `/<urlLocale>/`, verify locale in selector, prices in correct currency
