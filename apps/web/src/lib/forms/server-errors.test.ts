import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { applyServerErrors, extractIssues } from './server-errors';

describe('extractIssues', () => {
  it('reads zod issue arrays, { issues }, and flattened fieldErrors', () => {
    expect(extractIssues([{ path: ['email'], message: 'bad' }])).toEqual([
      { path: 'email', message: 'bad' },
    ]);
    expect(extractIssues({ issues: [{ path: ['a', 'b'], message: 'nested' }] })).toEqual([
      { path: 'a.b', message: 'nested' },
    ]);
    expect(extractIssues({ fieldErrors: { name: ['Required'] }, formErrors: [] })).toEqual([
      { path: 'name', message: 'Required' },
    ]);
    expect(extractIssues(undefined)).toEqual([]);
  });
});

describe('applyServerErrors', () => {
  it('maps VALIDATION_ERROR issues to known fields and ignores unknown ones', () => {
    const setError = vi.fn();
    const error = new ApiError({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid',
      details: [
        { path: ['email'], message: 'Invalid email' },
        { path: ['unknown'], message: 'ignored' },
      ],
    });
    const applied = applyServerErrors(error, setError, ['email', 'password'] as const);
    expect(applied).toBe(true);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith('email', { type: 'server', message: 'Invalid email' });
  });

  it('returns false for non-validation errors', () => {
    const setError = vi.fn();
    const error = new ApiError({ status: 409, code: 'CONFLICT', message: 'exists' });
    expect(applyServerErrors(error, setError, ['email'] as const)).toBe(false);
    expect(applyServerErrors(new Error('x'), setError, ['email'] as const)).toBe(false);
    expect(setError).not.toHaveBeenCalled();
  });
});
