import type { MessageKey } from './messages';
import { MESSAGES } from './messages';
import type { TParams } from './translate';

type Translate = (key: MessageKey, params?: TParams) => string;

export function hasMessage(key: string): key is MessageKey {
  return key in MESSAGES.en;
}

/** "past_due" -> "Past due"; the last-resort label for enum values the dictionary does not know. */
export function humanizeValue(value: string): string {
  return value.replace(/[_.-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Label for an API enum value: `<prefix>.<value>` when the dictionary has it, otherwise a humanised
 * version of the raw value (so a new backend value never renders blank or as a key).
 */
export function enumLabel(t: Translate, prefix: string, value: string, fallback?: string): string {
  const key = `${prefix}.${value}`;
  return hasMessage(key) ? t(key) : (fallback ?? humanizeValue(value));
}

const SYSTEM_ROLE_KEYS: Record<string, MessageKey> = {
  Owner: 'status.owner',
  Admin: 'status.admin',
  Member: 'status.member',
};

/** Built-in role names come from the API in English; translate them, leave custom role names as typed. */
export function roleLabel(t: Translate, name: string): string {
  const key = SYSTEM_ROLE_KEYS[name];
  return key ? t(key) : name;
}
