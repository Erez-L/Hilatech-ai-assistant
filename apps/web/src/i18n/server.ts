import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, dirOf, resolveLocale, type Locale } from './config';
import { createFormatter } from './format';
import { MESSAGES, en, type MessageKey } from './messages';
import { createTranslator } from './translate';
import { isMsg, type Msg } from './msg';

/** Locale for the current request: cookie (mirrors the saved preference) → Accept-Language → 'en'. */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
}

/** Server-component translator: `const t = await getT(); t('meta.title')`. */
export async function getT() {
  const locale = await getLocale();
  const base = createTranslator<MessageKey>(locale, MESSAGES[locale], en);
  const t = (key: MessageKey | Msg, params?: Parameters<typeof base>[1]) =>
    isMsg(key) ? base(key.key, { ...key.params, ...params }) : base(key, params);
  return {
    locale,
    dir: dirOf(locale),
    t,
    format: createFormatter(locale),
  };
}
