import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

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

// ---------------------------------------------------------------------------
// Symmetric encryption for secrets at rest (AI provider keys, integration credentials)
// ---------------------------------------------------------------------------

const SECRETBOX_VERSION = 'v1';

/**
 * AES-256-GCM envelope: `v1.<iv b64url>.<ciphertext b64url>.<tag b64url>`.
 * The key is 32 random bytes (base64 or base64url encoded), e.g. `openssl rand -base64 32`.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey.trim(), 'base64');
    if (key.length !== 32) {
      throw new Error('SecretBox key must decode to exactly 32 bytes (base64 of 32 random bytes)');
    }
    this.key = key;
  }

  encrypt(plaintext: string, aad?: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      SECRETBOX_VERSION,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  decrypt(envelope: string, aad?: string): string {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== SECRETBOX_VERSION) {
      throw new Error('Malformed secret envelope');
    }
    const [, ivB64, dataB64, tagB64] = parts as [string, string, string, string];
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Last `n` characters of a secret for display ("…ab12"). */
  static last(secret: string, n = 4): string {
    return secret.slice(-n);
  }
}
