'use client';

import { translateMessage } from './validation';
import { setActiveTranslator } from './active';
import { enumLabel } from './enums';
import * as React from 'react';
import { DirectionProvider, UiStringsProvider, type UiStrings } from '@hilatech/ui';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_META,
  dirOf,
  type Direction,
  type Locale,
} from './config';
import { createFormatter, type Formatter } from './format';
import { MESSAGES, en, type MessageKey } from './messages';
import { createTranslator, type TParams } from './translate';
import { isMsg, type Msg } from './msg';

/** Translate a dictionary key (or a lazily-defined `Msg`) with optional `{param}` values. */
export type T = (key: MessageKey | Msg, params?: TParams) => string;

interface I18nContextValue {
  locale: Locale;
  dir: Direction;
  t: T;
  format: Formatter;
  /** Switches language: updates cookie, <html lang dir>, and asks the app to re-render server output. */
  setLocale: (locale: Locale) => void;
}

export function wrapT(base: (key: MessageKey, params?: TParams) => string): T {
  return (key, params) =>
    isMsg(key) ? base(key.key, { ...key.params, ...params }) : base(key, params);
}

function build(locale: Locale, timeZone?: string): Omit<I18nContextValue, 'setLocale'> {
  return {
    locale,
    dir: dirOf(locale),
    t: wrapT(createTranslator<MessageKey>(locale, MESSAGES[locale], en)),
    format: createFormatter(locale, { timeZone }),
  };
}

// Without a provider (isolated unit tests, storybook-style renders) the app speaks English.
const I18nContext = React.createContext<I18nContextValue>({
  ...build(DEFAULT_LOCALE),
  setLocale: () => undefined,
});

/** Maps the design-system strings onto the active dictionary. */
function buildUiStrings(t: T): UiStrings {
  return {
    formatMessage: (message) => translateMessage(t, message),
    statusLabel: (status) => enumLabel(t, 'status', status),
    close: t('ui.close'),
    confirm: t('ui.confirm'),
    cancel: t('ui.cancel'),
    copy: t('ui.copy'),
    copied: t('ui.copied'),
    copyCode: t('ui.copyCode'),
    loading: t('ui.loading'),
    select: t('ui.select'),
    search: t('ui.search'),
    noResults: t('ui.noResults'),
    searching: t('ui.searching'),
    clearSelection: t('ui.clearSelection'),
    clearSearch: t('ui.clearSearch'),
    tryAgain: t('ui.tryAgain'),
    somethingWentWrong: t('ui.somethingWentWrong'),
    loadFailed: t('ui.loadFailed'),
    request: (id) => t('ui.request', { id }),
    pagination: t('ui.pagination'),
    rows: t('ui.rows'),
    previousPage: t('ui.previousPage'),
    nextPage: t('ui.nextPage'),
    items: t('ui.items'),
    noItems: (label) => t('ui.noItems', { label }),
    itemsRange: (start, end, total, label) => t('ui.itemsRange', { start, end, total, label }),
    pageOf: (page, total) => t('ui.pageOf', { page, total }),
    addTag: t('ui.addTag'),
    removeTag: (tag) => t('ui.removeTag', { tag }),
    selectedTags: t('ui.selectedTags'),
    primaryNavigation: t('ui.primaryNavigation'),
    empty: t('ui.empty'),
    tree: t('ui.tree'),
    raw: t('ui.raw'),
    collapse: (name) => t('ui.collapse', { name }),
    expand: (name) => t('ui.expand', { name }),
    total: t('ui.total'),
  };
}

export function writeLocaleCookie(locale: Locale) {
  if (typeof document === 'undefined') return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
}

export function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = locale;
  root.dir = LOCALE_META[locale].dir;
}

export function I18nProvider({
  locale: initialLocale,
  timeZone,
  onLocaleChange,
  children,
}: {
  locale: Locale;
  timeZone?: string;
  /** Called after a client-side switch; the app passes `router.refresh` so the server re-renders <html>. */
  onLocaleChange?: (locale: Locale) => void;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = React.useState<Locale>(initialLocale);

  // The server is the source of truth for the initial locale; follow it after a refresh.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocaleState(initialLocale);
  }, [initialLocale]);

  const setLocale = React.useCallback(
    (next: Locale) => {
      setLocaleState(next);
      writeLocaleCookie(next);
      applyDocumentLocale(next);
      onLocaleChange?.(next);
    },
    [onLocaleChange],
  );

  const value = React.useMemo<I18nContextValue>(
    () => ({ ...build(locale, timeZone), setLocale }),
    [locale, timeZone, setLocale],
  );

  React.useEffect(() => {
    setActiveTranslator(value.t);
  }, [value.t]);

  const uiStrings = React.useMemo(() => buildUiStrings(value.t), [value.t]);

  return (
    <I18nContext.Provider value={value}>
      <DirectionProvider dir={value.dir}>
        <UiStringsProvider strings={uiStrings}>{children}</UiStringsProvider>
      </DirectionProvider>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return React.useContext(I18nContext);
}
/** Translation function: `const t = useT(); t('leads.title')`. */
export function useT(): T {
  return React.useContext(I18nContext).t;
}
export function useLocale(): Locale {
  return React.useContext(I18nContext).locale;
}
export function useDir(): Direction {
  return React.useContext(I18nContext).dir;
}
/** Intl-based number/currency/date helpers bound to the active locale. */
export function useFormat(): Formatter {
  return React.useContext(I18nContext).format;
}
