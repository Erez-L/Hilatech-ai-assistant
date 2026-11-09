import type { ZodError } from 'zod';
import { extractIssues } from './server-errors';
import { isApiError } from '@/lib/api/client';

/** First message per dotted path of a zod error (`steps.0.url` → message). */
export function zodFieldErrors(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!(path in out)) out[path] = issue.message;
  }
  return out;
}

/** First message per path of an API validation error (empty when it is not one). */
export function serverFieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error) || !error.isValidation) return {};
  const out: Record<string, string> = {};
  for (const issue of extractIssues(error.details)) {
    if (!(issue.path in out)) out[issue.path] = issue.message;
  }
  return out;
}
