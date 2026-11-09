import { createHash } from 'node:crypto';

/**
 * Deterministic UUID (v5-style, SHA-1 of the joined parts). Used to make fan-out idempotent: a redelivered
 * `event` job derives the same execution / delivery ids, so inserts become no-ops (unique violation) instead
 * of duplicates.
 */
export function deterministicUuid(...parts: string[]): string {
  const hash = createHash('sha1').update(parts.join('\u0000')).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
