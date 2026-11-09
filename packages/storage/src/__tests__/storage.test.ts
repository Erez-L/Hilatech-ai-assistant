import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LocalStorageDriver,
  assertValidKey,
  buildObjectKey,
  createStorageDriver,
  sha256Hex,
} from '../index';

describe('storage keys', () => {
  it('builds tenant-scoped keys and rejects traversal', () => {
    const key = buildObjectKey(
      '11111111-1111-4111-8111-111111111111',
      'documents',
      'Quote Q4.PDF',
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(key).toMatch(
      /^org\/11111111-1111-4111-8111-111111111111\/documents\/2026\/03\/[0-9a-f-]{36}\.pdf$/,
    );
    expect(() => assertValidKey('../etc/passwd')).toThrow();
    expect(() => assertValidKey('org/a/../b')).toThrow();
    expect(() => assertValidKey('/absolute')).toThrow();
    expect(() => assertValidKey('ok/key.txt')).not.toThrow();
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('LocalStorageDriver', () => {
  let root: string;
  let driver: LocalStorageDriver;
  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'hta-storage-'));
    driver = new LocalStorageDriver(root);
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips objects with metadata and deletes them', async () => {
    const info = await driver.put({
      key: 'org/1/documents/a.txt',
      body: Buffer.from('hello'),
      contentType: 'text/plain',
    });
    expect(info.sizeBytes).toBe(5);
    expect((await driver.get('org/1/documents/a.txt')).toString()).toBe('hello');
    const head = await driver.head('org/1/documents/a.txt');
    expect(head?.contentType).toBe('text/plain');
    const stream = await driver.getStream('org/1/documents/a.txt');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe('hello');
    await driver.delete('org/1/documents/a.txt');
    expect(await driver.head('org/1/documents/a.txt')).toBeNull();
  });

  it('never escapes the root directory', async () => {
    await expect(driver.get('../outside')).rejects.toThrow(/Invalid storage key/);
  });

  it('factory picks the local driver by default', () => {
    expect(createStorageDriver({ driver: 'local', localPath: root }).kind).toBe('local');
    expect(() => createStorageDriver({ driver: 's3' })).toThrow();
  });
});

describe('resolveLocalStoragePath', () => {
  it('keeps absolute paths and anchors relative ones at the workspace root', async () => {
    const { resolveLocalStoragePath } = await import('../index');
    const { mkdtempSync, mkdirSync, writeFileSync, realpathSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    expect(resolveLocalStoragePath('/var/data/uploads')).toBe('/var/data/uploads');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ws-')));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
    mkdirSync(join(root, 'apps', 'api'), { recursive: true });
    expect(resolveLocalStoragePath('./uploads', join(root, 'apps', 'api'))).toBe(
      join(root, 'uploads'),
    );
    const lone = realpathSync(mkdtempSync(join(tmpdir(), 'nows-')));
    expect(resolveLocalStoragePath('uploads', lone)).toBe(join(lone, 'uploads'));
  });
});
