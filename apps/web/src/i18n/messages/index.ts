import type { Locale } from '../config';
import type { Messages } from '../translate';
import { en } from './en';
import { he } from './he';

export type MessageKey = keyof typeof en;

export const MESSAGES: Record<Locale, Messages> = { en, he };

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}
export { en, he };
