import { describe, expect, it } from 'vitest';

import { createEvaluationCaseSchema, evaluateCheck, scoreEvaluationCase } from '../index';

describe('evaluation scoring', () => {
  it('text checks ignore case and repeated whitespace', () => {
    expect(evaluateCheck({ type: 'contains', value: 'Thank  You' }, 'well, thank you!')).toBe(true);
    expect(evaluateCheck({ type: 'not_contains', value: 'refund' }, 'No REFUND today')).toBe(false);
    expect(evaluateCheck({ type: 'equals', value: ' Yes ' }, 'yes')).toBe(true);
    expect(evaluateCheck({ type: 'equals', value: 'yes' }, 'yes, sure')).toBe(false);
  });

  it('regex checks are case-insensitive and an invalid pattern never passes', () => {
    expect(
      evaluateCheck({ type: 'regex', value: 'order\\s+#\\d+' }, 'Your ORDER #42 shipped'),
    ).toBe(true);
    expect(evaluateCheck({ type: 'regex', value: '(' }, 'anything')).toBe(false);
  });

  it('a case passes only when every check passes; no checks never passes', () => {
    const mixed = scoreEvaluationCase(
      [
        { type: 'contains', value: 'hello' },
        { type: 'not_contains', value: 'hello' },
      ],
      'Hello there',
    );
    expect(mixed.passed).toBe(false);
    expect(mixed.checks.map((c) => c.passed)).toEqual([true, false]);
    expect(scoreEvaluationCase([], 'x').passed).toBe(false);
  });

  it('rejects cases with an invalid regular expression or without checks', () => {
    const base = { name: 'n', input: 'i' };
    expect(
      createEvaluationCaseSchema.safeParse({ ...base, checks: [{ type: 'regex', value: '(' }] })
        .success,
    ).toBe(false);
    expect(createEvaluationCaseSchema.safeParse({ ...base, checks: [] }).success).toBe(false);
    expect(
      createEvaluationCaseSchema.safeParse({ ...base, checks: [{ type: 'contains', value: 'a' }] })
        .success,
    ).toBe(true);
  });
});
