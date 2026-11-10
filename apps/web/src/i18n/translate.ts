import type { Locale } from './config';

/** A message is a string with `{param}` placeholders, or a plural table selected by `params.count`. */
export type PluralMessage = {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};
export type Message = string | PluralMessage;
export type Messages = Record<string, Message>;
export type TParams = Record<string, string | number | null | undefined>;

const pluralRulesCache = new Map<string, Intl.PluralRules>();

function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRulesCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, rules);
  }
  return rules.select(count);
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function interpolate(template: string, params: TParams | undefined, locale: Locale): string {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return whole;
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

export function pickMessage(message: Message, locale: Locale, params?: TParams): string {
  if (typeof message === 'string') return message;
  const count = params?.count;
  if (typeof count !== 'number') return message.other;
  if (count === 0 && message.zero !== undefined) return message.zero;
  return message[pluralCategory(locale, count)] ?? message.other;
}

export type TranslateFn<K extends string = string> = (key: K, params?: TParams) => string;

/**
 * Builds a translator. Missing keys fall back to the fallback dictionary (English), then to the key itself,
 * so a missing translation degrades to English instead of crashing. The parity test keeps this from happening.
 */
export function createTranslator<K extends string>(
  locale: Locale,
  messages: Record<string, Message>,
  fallback?: Record<string, Message>,
): TranslateFn<K> {
  return (key, params) => {
    const message = messages[key] ?? fallback?.[key];
    if (message === undefined) return key;
    return interpolate(pickMessage(message, locale, params), params, locale);
  };
}
