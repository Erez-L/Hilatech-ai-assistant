import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/client';
import { validateUploadFile } from '@/lib/knowledge';
import {
  PLACEHOLDER_ID,
  applyPlaceholders,
  findPlaceholders,
  issuesFromError,
  parseIssuePath,
  uniqueStepId,
} from '@/lib/automation';
import { tEn as t, fmtEn as fmt } from '@/test/i18n';
import type { WorkflowStep } from '@hilatech/contracts';

describe('validateUploadFile', () => {
  it('accepts supported types and rejects unsupported, empty and oversized files', () => {
    expect(validateUploadFile({ name: 'a.TXT', size: 10 }, t, fmt)).toBeNull();
    expect(validateUploadFile({ name: 'a.exe', size: 10 }, t, fmt)).toMatch(/Unsupported/);
    expect(validateUploadFile({ name: 'a.txt', size: 0 }, t, fmt)).toMatch(/empty/);
    expect(validateUploadFile({ name: 'a.pdf', size: 100 }, t, fmt, 50)).toMatch(/limit/);
    expect(fmt.bytes(2048)).toBe('2.0 KB');
  });
});

describe('workflow templates', () => {
  const steps: WorkflowStep[] = [
    { id: 'digest', type: 'agent_run', agentId: PLACEHOLDER_ID, input: 'x', wait: true },
    {
      id: 'tell',
      type: 'send_notification',
      to: { kind: 'user', userId: PLACEHOLDER_ID },
      title: 't',
    },
  ];
  it('finds and fills placeholder ids', () => {
    const found = findPlaceholders(steps, t);
    expect(found.map((p) => p.key)).toEqual(['digest.agentId', 'tell.userId']);
    const filled = applyPlaceholders(steps, { 'digest.agentId': 'a-1', 'tell.userId': 'u-1' });
    expect(findPlaceholders(filled, t)).toHaveLength(0);
    expect(JSON.stringify(filled)).toContain('a-1');
  });
  it('generates unique step ids', () => {
    expect(uniqueStepId('http_request', ['http-request-1'])).toBe('http-request-2');
  });
});

describe('issue parsing', () => {
  it('parses both path styles', () => {
    expect(parseIssuePath('steps[1].then[0]')).toEqual({ index: 1, rest: 'then[0]' });
    expect(parseIssuePath('steps.2.timeoutMs')).toEqual({ index: 2, rest: 'timeoutMs' });
    expect(parseIssuePath('trigger.cron').index).toBeNull();
  });
  it('maps validator and zod style errors onto step ids', () => {
    const base = { status: 400, code: 'VALIDATION_ERROR', message: 'x' };
    const a = new ApiError({
      ...base,
      details: { issues: [{ stepId: 'a', path: 'steps[0].agentId', message: 'nope' }] },
    });
    expect(issuesFromError(a, ['a'])).toEqual([
      { stepId: 'a', path: 'steps[0].agentId', message: 'nope' },
    ]);
    const b = new ApiError({ ...base, details: [{ path: 'steps.1.url', message: 'bad' }] });
    expect(issuesFromError(b, ['a', 'b'])[0]).toMatchObject({ stepId: 'b', message: 'bad' });
  });
});
