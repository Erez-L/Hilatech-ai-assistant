import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { S3Client } from '@aws-sdk/client-s3';

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StoredObjectInfo {
  key: string;
  sizeBytes: number;
  contentType: string | null;
}

/** Minimal object-storage contract. Keys are opaque, `/`-separated, never user-controlled paths. */
export interface StorageDriver {
  readonly kind: 'local' | 's3';
  put(input: PutObjectInput): Promise<StoredObjectInfo>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Promise<Readable>;
  head(key: string): Promise<StoredObjectInfo | null>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;

/** Reject traversal and odd characters before any driver sees the key. */
export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.length > 512) {
    throw new Error(`Invalid storage key: ${key}`);
  }
}

/** Build a tenant-scoped key: `org/<orgId>/<category>/<yyyy>/<mm>/<uuid><ext>`. */
export function buildObjectKey(
  organizationId: string,
  category: string,
  fileName: string,
  now = new Date(),
): string {
  const ext = path
    .extname(fileName)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .slice(0, 10);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `org/${organizationId}/${category}/${yyyy}/${mm}/${randomUUID()}${ext}`;
  assertValidKey(key);
  return key;
}

export function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

// ---------------------------------------------------------------------------
// Local disk driver (development / single-node)
// ---------------------------------------------------------------------------

export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(rootPath: string) {
    this.root = path.resolve(rootPath);
  }

  private resolve(key: string): string {
    assertValidKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(`${this.root}${path.sep}`)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(input: PutObjectInput): Promise<StoredObjectInfo> {
    const full = this.resolve(input.key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, input.body);
    await writeFile(
      `${full}.meta.json`,
      JSON.stringify({ contentType: input.contentType, metadata: input.metadata ?? {} }),
    );
    return { key: input.key, sizeBytes: input.body.length, contentType: input.contentType };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async getStream(key: string): Promise<Readable> {
    const full = this.resolve(key);
    await stat(full);
    return createReadStream(full);
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const full = this.resolve(key);
    try {
      const info = await stat(full);
      let contentType: string | null = null;
      try {
        const meta = JSON.parse(await readFile(`${full}.meta.json`, 'utf8')) as {
          contentType?: string;
        };
        contentType = meta.contentType ?? null;
      } catch {
        contentType = null;
      }
      return { key, sizeBytes: info.size, contentType };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await rm(full, { force: true });
    await rm(`${full}.meta.json`, { force: true });
  }
}

// ---------------------------------------------------------------------------
// S3-compatible driver (AWS S3, MinIO, R2…). The SDK is loaded lazily so local setups never import it.
// ---------------------------------------------------------------------------

export interface S3DriverOptions {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** Path-style addressing (required by MinIO and most self-hosted gateways). */
  forcePathStyle?: boolean;
  /** Key prefix inside the bucket. */
  prefix?: string;
}

export class S3StorageDriver implements StorageDriver {
  readonly kind = 's3' as const;
  private clientPromise: Promise<S3Client> | null = null;

  constructor(private readonly options: S3DriverOptions) {
    if (!options.bucket) throw new Error('S3 storage requires a bucket');
  }

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = import('@aws-sdk/client-s3').then(({ S3Client }) => {
        return new S3Client({
          region: this.options.region,
          endpoint: this.options.endpoint,
          forcePathStyle: this.options.forcePathStyle ?? Boolean(this.options.endpoint),
          credentials:
            this.options.accessKeyId && this.options.secretAccessKey
              ? {
                  accessKeyId: this.options.accessKeyId,
                  secretAccessKey: this.options.secretAccessKey,
                }
              : undefined,
        });
      });
    }
    return this.clientPromise;
  }

  private fullKey(key: string): string {
    assertValidKey(key);
    return this.options.prefix ? `${this.options.prefix.replace(/\/+$/, '')}/${key}` : key;
  }

  async put(input: PutObjectInput): Promise<StoredObjectInfo> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: this.fullKey(input.key),
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
    return { key: input.key, sizeBytes: input.body.length, contentType: input.contentType };
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const result = await client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: this.fullKey(key) }),
    );
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object not found: ${key}`);
    return Buffer.from(bytes);
  }

  async getStream(key: string): Promise<Readable> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const result = await client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: this.fullKey(key) }),
    );
    if (!result.Body) throw new Error(`Object not found: ${key}`);
    return result.Body as unknown as Readable;
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    try {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: this.options.bucket, Key: this.fullKey(key) }),
      );
      return {
        key,
        sizeBytes: Number(result.ContentLength ?? 0),
        contentType: result.ContentType ?? null,
      };
    } catch (error) {
      if (
        (error as { name?: string }).name === 'NotFound' ||
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.fullKey(key) }),
    );
  }
}

// ---------------------------------------------------------------------------
// Factory from environment-style config
// ---------------------------------------------------------------------------

export interface StorageConfig {
  driver: 'local' | 's3';
  localPath?: string;
  s3?: S3DriverOptions;
}

/**
 * Resolve the local storage directory. Relative paths are anchored at the monorepo root (the directory
 * holding `pnpm-workspace.yaml`) so the API and the workers — which run from different working
 * directories — always share the same files. Falls back to the current directory outside a workspace.
 */
export function resolveLocalStoragePath(configured: string, cwd = process.cwd()): string {
  if (path.isAbsolute(configured)) return path.resolve(configured);
  let dir = path.resolve(cwd);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.resolve(dir, configured);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(cwd, configured);
}

export function createStorageDriver(config: StorageConfig): StorageDriver {
  if (config.driver === 's3') {
    if (!config.s3) throw new Error('STORAGE_DRIVER=s3 requires S3 settings');
    return new S3StorageDriver(config.s3);
  }
  return new LocalStorageDriver(resolveLocalStoragePath(config.localPath ?? './uploads'));
}
