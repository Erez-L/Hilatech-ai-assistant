import type {
  DuplicateStrategy,
  ImportEntity,
  ImportJob,
  ImportMapping,
  ImportReport,
  ImportStatus,
  ImportUploadResult,
  PaginationQuery,
} from '@hilatech/contracts';
import { api, type QueryParams } from './client';
import { filenameFromDisposition, type CsvDownload } from './analytics';

export interface ListImportsParams extends Partial<PaginationQuery> {
  entity?: ImportEntity;
  status?: ImportStatus;
}

export interface ImportConfigBody {
  mapping: ImportMapping;
  duplicateStrategy: DuplicateStrategy;
}

export type ExportEntity = ImportEntity | 'tasks';
const enc = encodeURIComponent;

export const importsApi = {
  /** POST /imports (multipart: file + entity). */
  upload: (entity: ImportEntity, file: File) => {
    const form = new FormData();
    form.append('entity', entity);
    form.append('file', file);
    return api.post<ImportUploadResult>('/imports', form);
  },
  list: (query: ListImportsParams = {}) =>
    api.list<ImportJob>('/imports', {
      page: query.page,
      pageSize: query.pageSize,
      entity: query.entity,
      status: query.status,
    }),
  get: (id: string) => api.get<ImportJob>(`/imports/${enc(id)}`),
  validate: (id: string, body: ImportConfigBody) =>
    api.post<ImportJob>(`/imports/${enc(id)}/validate`, body),
  execute: (id: string, body: ImportConfigBody) =>
    api.post<ImportJob>(`/imports/${enc(id)}/execute`, body),
  cancel: (id: string) => api.post<ImportJob>(`/imports/${enc(id)}/cancel`),
  report: (id: string) => api.get<ImportReport>(`/imports/${enc(id)}/report`),
  reportCsv: async (id: string): Promise<CsvDownload> => {
    const res = await api.fetchRaw(`/imports/${enc(id)}/report.csv`, {
      headers: { Accept: 'text/csv' },
    });
    return {
      blob: await res.blob(),
      filename: filenameFromDisposition(
        res.headers.get('content-disposition'),
        `import-${id}-report.csv`,
      ),
    };
  },
};

export const exportsApi = {
  /** GET /export/<entity>?<list filters> -> authenticated CSV download. */
  download: async (entity: ExportEntity, filters: QueryParams = {}): Promise<CsvDownload> => {
    const res = await api.fetchRaw(`/export/${entity}`, {
      query: filters,
      headers: { Accept: 'text/csv' },
    });
    return {
      blob: await res.blob(),
      filename: filenameFromDisposition(res.headers.get('content-disposition'), `${entity}.csv`),
    };
  },
};
