'use client';

import * as React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState } from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';

export interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  loading: React.ReactNode;
  /** Render when the query has data. */
  children: (data: T) => React.ReactNode;
  /** Optional check that decides whether the data counts as empty. */
  isEmpty?: (data: T) => boolean;
  empty?: React.ReactNode;
  /** Compact error rendering (inside cards/tables). */
  compact?: boolean;
  errorTitle?: string;
}

/** Renders loading / error (with retry) / empty / success for a react-query result. */
export function QueryState<T>({
  query,
  loading,
  children,
  isEmpty,
  empty,
  compact,
  errorTitle,
}: QueryStateProps<T>) {
  if (query.isPending) return <>{loading}</>;
  if (query.isError) {
    const err = query.error;
    const forbidden = isApiError(err) && err.isForbidden;
    return (
      <ErrorState
        compact={compact}
        title={
          forbidden ? 'You don’t have access to this' : (errorTitle ?? 'This couldn’t be loaded')
        }
        message={getErrorMessage(err)}
        requestId={isApiError(err) ? err.requestId : undefined}
        onRetry={forbidden ? undefined : () => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  const data = query.data as T;
  if (isEmpty?.(data) && empty) return <>{empty}</>;
  return <>{children(data)}</>;
}
