import type { MessageKey } from './messages';
import type { TParams } from './translate';

/**
 * Lazily translated message for module-level data (label maps, nav config, option lists) that cannot
 * call `t` at import time. Render with `t(ref)`; the key is type-checked against the dictionary.
 */
export interface Msg {
  readonly key: MessageKey;
  readonly params?: TParams;
}

export const msg = (key: MessageKey, params?: TParams): Msg => ({ key, params });

export function isMsg(value: unknown): value is Msg {
  return typeof value === 'object' && value !== null && 'key' in value;
}

/** Translates a `Msg`, passing plain strings (e.g. unknown enum values from the API) through unchanged. */
export function tm(t: (m: Msg) => string, value: Msg | string | null | undefined): string {
  if (value == null) return '';
  return typeof value === 'string' ? value : t(value);
}
