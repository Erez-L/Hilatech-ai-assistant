import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  hashEndpointSecret,
  signInboundPayload,
  signOutboundPayload,
  verifyInboundRequest,
  verifyOutboundSignature,
  webhookBackoffMs,
} from '../automation/webhook-signature';

describe('outbound signatures', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ a: 1 });
  it('signs timestamp.body with HMAC-SHA256 (known vector shape)', () => {
    const sig = signOutboundPayload(secret, 1700000000, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sig).toBe(signOutboundPayload(secret, '1700000000', body));
    expect(sig).not.toBe(signOutboundPayload(secret, 1700000001, body));
    expect(sig).not.toBe(signOutboundPayload('other', 1700000000, body));
  });
  it('verifies within tolerance and rejects stale/tampered', () => {
    const ts = 1700000000;
    const sig = signOutboundPayload(secret, ts, body);
    expect(
      verifyOutboundSignature({ secret, timestamp: ts, body, signature: sig, nowSeconds: ts + 10 }),
    ).toBe(true);
    expect(
      verifyOutboundSignature({
        secret,
        timestamp: ts,
        body,
        signature: sig,
        nowSeconds: ts + 3600,
      }),
    ).toBe(false);
    expect(
      verifyOutboundSignature({
        secret,
        timestamp: ts,
        body: body + ' ',
        signature: sig,
        nowSeconds: ts,
      }),
    ).toBe(false);
  });
});

describe('inbound verification', () => {
  const secret = 'in_secret_123';
  const hash = hashEndpointSecret(secret);
  const rawBody = '{"hello":"world"}';

  it('accepts a valid signature (no timestamp)', () => {
    const r = verifyInboundRequest({
      secretHash: hash,
      rawBody,
      signatureHeader: signInboundPayload(secret, rawBody),
    });
    expect(r).toEqual({ ok: true, method: 'signature' });
  });
  it('accepts a valid timestamped signature and rejects stale ones', () => {
    const now = 1_800_000_000;
    const sig = signInboundPayload(secret, rawBody, now);
    expect(
      verifyInboundRequest({
        secretHash: hash,
        rawBody,
        signatureHeader: sig,
        timestampHeader: String(now),
        nowSeconds: now + 5,
      }),
    ).toEqual({ ok: true, method: 'signature' });
    expect(
      verifyInboundRequest({
        secretHash: hash,
        rawBody,
        signatureHeader: sig,
        timestampHeader: String(now),
        nowSeconds: now + 9999,
      }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
    // stripping the timestamp from a timestamped signature fails
    expect(verifyInboundRequest({ secretHash: hash, rawBody, signatureHeader: sig })).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });
  it('rejects tampered body / wrong secret signatures', () => {
    const sig = signInboundPayload(secret, rawBody);
    expect(
      verifyInboundRequest({ secretHash: hash, rawBody: rawBody + 'x', signatureHeader: sig }).ok,
    ).toBe(false);
    expect(
      verifyInboundRequest({
        secretHash: hash,
        rawBody,
        signatureHeader: signInboundPayload('nope', rawBody),
      }).ok,
    ).toBe(false);
    expect(
      verifyInboundRequest({ secretHash: hash, rawBody, signatureHeader: 'sha256=zz' }).ok,
    ).toBe(false);
  });
  it('supports the plain secret header and compares hashes', () => {
    expect(verifyInboundRequest({ secretHash: hash, rawBody, secretHeader: secret })).toEqual({
      ok: true,
      method: 'secret',
    });
    expect(verifyInboundRequest({ secretHash: hash, rawBody, secretHeader: 'wrong' })).toEqual({
      ok: false,
      reason: 'invalid_secret',
    });
  });
  it('rejects requests without credentials', () => {
    expect(verifyInboundRequest({ secretHash: hash, rawBody })).toEqual({
      ok: false,
      reason: 'missing',
    });
  });
});

describe('helpers', () => {
  it('constantTimeEqual handles different lengths', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
  it('backoff grows and caps', () => {
    expect(webhookBackoffMs(1)).toBeLessThan(webhookBackoffMs(2));
    expect(webhookBackoffMs(2)).toBeLessThan(webhookBackoffMs(3));
    expect(webhookBackoffMs(99)).toBe(webhookBackoffMs(5));
    expect(webhookBackoffMs(0)).toBe(webhookBackoffMs(1));
  });
});
