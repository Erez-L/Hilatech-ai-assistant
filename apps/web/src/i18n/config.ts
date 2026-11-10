/**
 * Isomorphic i18n configuration (safe to import from server and client code).
 * Locale is NOT part of the URL: it is resolved per request from, in order,
 * the saved user preference, the `hta_locale` cookie, `Accept-Language`, then `DEFAULT_LOCALE`.
 */
export const LOCALES = ['en', 'he'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'hta_locale';
/** sessionStorage flag: the user explicitly picked a language while signed out; push it to the profile on sign-in. */
export const LOCALE_PENDING_KEY = 'hta.localePending';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Direction = 'ltr' | 'rtl';

export const LOCALE_META: Record<Locale, { dir: Direction; nativeName: string; intl: string }> = {
  en: { dir: 'ltr', nativeName: 'English', intl: 'en-US' },
  he: { dir: 'rtl', nativeName: 'עברית', intl: 'he-IL' },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): Direction {
  return LOCALE_META[locale].dir;
}

/** Maps tags such as `he-IL`, `iw`, `en-GB` to a supported locale, or null. */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  if (base === 'iw') return 'he';
  return isLocale(base) ? base : null;
}

/** Picks the best supported locale from an Accept-Language header (q-values respected). */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return { tag, weight: Number.isNaN(weight) ? 0 : weight, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const locale = normalizeLocale(tag);
    if (locale) return locale;
  }
  return null;
}

export interface LocaleSources {
  preference?: string | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}

/** preference → cookie → Accept-Language → default. */
export function resolveLocale(sources: LocaleSources = {}): Locale {
  return (
    normalizeLocale(sources.preference) ??
    normalizeLocale(sources.cookie) ??
    parseAcceptLanguage(sources.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}
