import { type PaginationMeta, type PaginationQuery } from '@hilatech/contracts';

/** Marker class returned by list handlers; `TransformInterceptor` turns it into `{ data, meta }`. */
export class PageResult<T> {
  constructor(
    public readonly data: T[],
    public readonly meta: PaginationMeta,
  ) {}
}

export function paginationMeta(query: PaginationQuery, total: number): PaginationMeta {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

export function skipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function page<T>(data: T[], query: PaginationQuery, total: number): PageResult<T> {
  return new PageResult(data, paginationMeta(query, total));
}
