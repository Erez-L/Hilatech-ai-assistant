import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { vm } from '@/i18n/validation';
import { isApiError } from '@/lib/api/client';

interface IssueLike {
  path?: (string | number)[] | string;
  message?: string;
}

/** Extract zod-style issues from an ApiError `details` payload (several shapes are tolerated). */
export function extractIssues(details: unknown): { path: string; message: string }[] {
  if (!details) return [];
  const list: unknown[] = Array.isArray(details)
    ? details
    : typeof details === 'object' && details !== null
      ? ((details as { issues?: unknown[]; errors?: unknown[] }).issues ??
        (details as { issues?: unknown[]; errors?: unknown[] }).errors ??
        flattenFieldErrors(details as Record<string, unknown>))
      : [];
  return list
    .map((raw) => {
      const issue = raw as IssueLike;
      const path = Array.isArray(issue.path)
        ? issue.path.join('.')
        : typeof issue.path === 'string'
          ? issue.path
          : '';
      return { path, message: issue.message ?? vm('validation.invalidValue') };
    })
    .filter((i) => i.message);
}

function flattenFieldErrors(details: Record<string, unknown>): unknown[] {
  // zod `flatten()` shape: { fieldErrors: { email: ['msg'] }, formErrors: ['msg'] }
  const fieldErrors = details.fieldErrors as Record<string, string[]> | undefined;
  if (!fieldErrors) return [];
  return Object.entries(fieldErrors).flatMap(([field, messages]) =>
    (messages ?? []).map((message) => ({ path: field, message })),
  );
}

/**
 * Map a VALIDATION_ERROR response onto react-hook-form fields.
 * Returns true when at least one field error was set; otherwise the caller should show a form-level message.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!isApiError(error) || !error.isValidation) return false;
  const issues = extractIssues(error.details);
  let applied = false;
  for (const issue of issues) {
    const field = fields.find((f) => f === issue.path || issue.path.startsWith(`${f}.`));
    if (field) {
      setError(field, { type: 'server', message: issue.message });
      applied = true;
    }
  }
  return applied;
}
