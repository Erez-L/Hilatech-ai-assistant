import { createFormatter } from '@/i18n/format';
import { MESSAGES } from '@/i18n/messages';
import { createTranslator } from '@/i18n/translate';
import { wrapT } from '@/i18n/provider';
import type { Locale } from '@/i18n/config';

/** Standalone English translator + formatter for unit tests of pure helpers. */
export const tEn = wrapT(createTranslator('en', MESSAGES.en, MESSAGES.en) as never);
export const fmtEn = createFormatter('en', { timeZone: 'UTC' });

export function testI18n(locale: Locale = 'en') {
  return {
    t: wrapT(createTranslator(locale, MESSAGES[locale], MESSAGES.en) as never),
    fmt: createFormatter(locale, { timeZone: 'UTC' }),
  };
}
