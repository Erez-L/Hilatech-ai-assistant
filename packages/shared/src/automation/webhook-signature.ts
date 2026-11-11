import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** `sha256=<hex>` — the format of every HilaTech webhook signature header. */
export const SIGNATURE_PREFIX = 'sha256=';
/** Replay window for timestamped signatures (seconds). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

function hmacHex(key: string, payload: string): string {
  return createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

/** Constant-time string comparison that never leaks length through an early return. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = createHash('sha256').update(a).digest();
  const bb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ab, bb) && a.length === b.length;
}

// -- Outbound (we sign, the customer verifies) -----------------------------------------------------

/** `sha256=hex(HMAC_SHA256(secret, "<timestamp>.<body>"))`. */
export function signOutboundPayload(
  secret: string,
  timestamp: number | string,
  body: string,
): string {
  return `${SIGNATURE_PREFIX}${hmacHex(secret, `${timestamp}.${body}`)}`;
}

export function verifyOutboundSignature(params: {
  secret: string;
  timestamp: number | string;
  body: string;
  signature: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): boolean {
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (params.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return false;
  return constantTimeEqual(
    signOutboundPayload(params.secret, params.timestamp, params.body),
    params.signature,
  );
}

// -- Inbound (the customer signs, we verify) ---------------------------------------------------------

/** SHA-256 hex of an inbound endpoint secret: this is what is stored (`WebhookEndpoint.secretHash`). */
export function hashEndpointSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/**
 * Signature a sender computes for an inbound endpoint. Because the server stores only `SHA-256(secret)`,
 * the HMAC key is that hash (hex): `sha256=hex(HMAC_SHA256(key=SHA-256(secret), body))`. When the sender also
 * supplies `x-hilatech-timestamp`, the signed string is `"<timestamp>.<body>"` (replay protection).
 */
export function signInboundPayload(
  secret: string,
  body: string,
  timestamp?: number | string,
): string {
  const key = hashEndpointSecret(secret);
  return `${SIGNATURE_PREFIX}${hmacHex(key, timestamp === undefined ? body : `${timestamp}.${body}`)}`;
}

export type InboundAuthResult =
  | { ok: true; method: 'signature' | 'secret' }
  | { ok: false; reason: 'missing' | 'invalid_signature' | 'invalid_secret' | 'stale_timestamp' };

/** Verifies an inbound request against the stored secret hash. Constant-time on every path. */
export function verifyInboundRequest(params: {
  secretHash: string;
  rawBody: string;
  signatureHeader?: string | undefined;
  timestampHeader?: string | undefined;
  secretHeader?: string | undefined;
  nowSeconds?: number;
}): InboundAuthResult {
  const { secretHash, rawBody, signatureHeader, timestampHeader, secretHeader } = params;
  if (signatureHeader) {
    let signed = rawBody;
    if (timestampHeader) {
      const ts = Number(timestampHeader);
      const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_SECONDS) {
        return { ok: false, reason: 'stale_timestamp' };
      }
      signed = `${timestampHeader}.${rawBody}`;
    }
    const expected = `${SIGNATURE_PREFIX}${hmacHex(secretHash, signed)}`;
    return constantTimeEqual(expected, signatureHeader.trim())
      ? { ok: true, method: 'signature' }
      : { ok: false, reason: 'invalid_signature' };
  }
  if (secretHeader) {
    return constantTimeEqual(hashEndpointSecret(secretHeader), secretHash)
      ? { ok: true, method: 'secret' }
      : { ok: false, reason: 'invalid_secret' };
  }
  return { ok: false, reason: 'missing' };
}

/** Exponential backoff for delivery attempt `n` (1-based = the attempt that just failed): 30s, 2m, 10m, 1h, … */
export function webhookBackoffMs(failedAttempt: number): number {
  const schedule = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
  return schedule[Math.min(Math.max(failedAttempt, 1), schedule.length) - 1]!;
}
