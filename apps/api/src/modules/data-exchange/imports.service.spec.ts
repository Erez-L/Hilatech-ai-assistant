import { type ImportJob as Row } from '@hilatech/database';

import { toImportJob } from './imports.service';

const base = {
  id: 'i1',
  organizationId: 'o1',
  entity: 'contacts',
  status: 'running',
  fileName: 'a.csv',
  sizeBytes: 10,
  storageKey: 'k',
  checksum: null,
  encoding: 'utf-8',
  delimiter: ',',
  headers: ['a'],
  totalRows: 200,
  mapping: { firstName: 0 },
  duplicateStrategy: 'skip',
  validation: null,
  processedRows: 50,
  createdCount: 40,
  updatedCount: 5,
  skippedCount: 3,
  failedCount: 2,
  report: [],
  error: null,
  createdById: 'u1',
  startedAt: new Date('2030-01-01T00:00:00Z'),
  finishedAt: null,
  createdAt: new Date('2030-01-01T00:00:00Z'),
  updatedAt: new Date('2030-01-01T00:00:00Z'),
} as unknown as Row;

describe('toImportJob', () => {
  it('maps counters, progress and never exposes the storage key', () => {
    const dto = toImportJob(base);
    expect(dto.progress).toEqual({ processed: 50, total: 200, percent: 25 });
    expect(dto.result).toEqual({ created: 40, updated: 5, skipped: 3, failed: 2 });
    expect(JSON.stringify(dto)).not.toContain('"storageKey"');
  });

  it('caps progress at the total and reports 100% for empty completed jobs', () => {
    expect(toImportJob({ ...base, processedRows: 999 } as Row).progress.processed).toBe(200);
    expect(toImportJob({ ...base, totalRows: 0, processedRows: 0, status: 'completed' } as Row).progress.percent).toBe(100);
  });
});
