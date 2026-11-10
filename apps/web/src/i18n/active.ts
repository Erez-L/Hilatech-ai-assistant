import type { MessageKey } from './messages';
import { MESSAGES } from './messages';
import { createTranslator, type TParams } from './translate';
import { translateMessage } from './validation';

/**
 * Client-only handle on the current translator for code that runs outside React (the API client's
 * error messages, toasts raised from event handlers). I18nProvider keeps it in sync. It is never read
 * during server rendering, so it cannot leak a locale between requests.
 */
type Translate = (key: MessageKey, params?: TParams) => string;

let active: Translate = createTranslator('en', MESSAGES.en, MESSAGES.en) as Translate;

export function setActiveTranslator(t: Translate): void {
  active = t;
}

export function activeT(key: MessageKey, params?: TParams): string {
  return active(key, params);
}

export function translateActive(message: string): string {
  return translateMessage(active, message);
}
