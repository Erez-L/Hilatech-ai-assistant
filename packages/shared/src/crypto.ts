import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Generate a URL-safe opaque token (default 48 random bytes → 64 chars). Never store the raw value. */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest — used to store refresh/reset/invitation tokens at rest. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time comparison of two hex/base64 strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
