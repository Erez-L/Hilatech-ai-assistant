import { describe, expect, it } from 'vitest';
import type { WorkflowStep } from '../automation';
import {
  CronParseError,
  cronIsDue,
  evaluateCondition,
  isValidCron,
  parseCron,
  renderDeep,
  renderTemplate,
  renderTemplateValue,
  resolvePath,
  validateWorkflowDefinition,
  zonedParts,
} from '../automation-rules';

describe('cron', () => {
  it('parses wildcards, lists, ranges, steps and names', () => {
    const c = parseCron('*/15 9-17 1,15 jan-mar mon-fri');
    expect([...c.minute]).toEqual([0, 15, 30, 45]);
    expect(c.hour.has(9) && c.hour.has(17) && !c.hour.has(18)).toBe(true);
    expect([...c.dayOfMonth]).toEqual([1, 15]);
    expect([...c.month]).toEqual([1, 2, 3]);
    expect([...c.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });
  it('treats 7 as Sunday', () => {
    expect([...parseCron('0 0 * * 7').dayOfWeek]).toEqual([0]);
  });
  it.each([
    '* * * *',
    '60 * * * *',
    '* 24 * * *',
    '*/0 * * * *',
    '5-1 * * * *',
    'a b c d e',
    '* * 0 * *',
    '1//2 * * * *',
  ])('rejects %s', (expr) => {
    expect(isValidCron(expr)).toBe(false);
  });
  it('throws CronParseError', () => {
    expect(() => parseCron('x')).toThrow(CronParseError);
  });

  it('computes due minutes in UTC', () => {
    expect(cronIsDue('30 8 * * *', new Date('2026-03-10T08:30:45Z'))).toBe(true);
    expect(cronIsDue('30 8 * * *', new Date('2026-03-10T08:31:00Z'))).toBe(false);
    expect(cronIsDue('*/5 * * * *', new Date('2026-03-10T08:35:00Z'))).toBe(true);
    expect(cronIsDue('*/5 * * * *', new Date('2026-03-10T08:36:00Z'))).toBe(false);
  });
  it('evaluates in the organization time zone (incl. DST)', () => {
    // Jerusalem: UTC+2 in winter, UTC+3 in summer.
    expect(cronIsDue('0 9 * * *', new Date('2026-01-15T07:00:00Z'), 'Asia/Jerusalem')).toBe(true);
    expect(cronIsDue('0 9 * * *', new Date('2026-01-15T06:00:00Z'), 'Asia/Jerusalem')).toBe(false);
    expect(cronIsDue('0 9 * * *', new Date('2026-07-15T06:00:00Z'), 'Asia/Jerusalem')).toBe(true);
    expect(cronIsDue('0 9 * * *', new Date('2026-07-15T07:00:00Z'), 'Asia/Jerusalem')).toBe(false);
    // Day rollover: 23:30 UTC is already the next weekday in Jerusalem.
    expect(zonedParts(new Date('2026-03-09T23:30:00Z'), 'Asia/Jerusalem').weekday).toBe(2); // Tuesday
    expect(cronIsDue('30 1 * * tue', new Date('2026-03-09T23:30:00Z'), 'Asia/Jerusalem')).toBe(
      true,
    );
  });
  it('applies POSIX day-of-month / day-of-week OR semantics', () => {
    // 2026-03-13 is a Friday, 13th. "0 0 13 * fri" fires on either.
    expect(cronIsDue('0 0 13 * fri', new Date('2026-03-13T00:00:00Z'))).toBe(true);
    expect(cronIsDue('0 0 13 * fri', new Date('2026-03-20T00:00:00Z'))).toBe(true); // Friday, not 13th
    expect(cronIsDue('0 0 13 * fri', new Date('2026-03-14T00:00:00Z'))).toBe(false);
    expect(cronIsDue('0 0 13 * *', new Date('2026-03-20T00:00:00Z'))).toBe(false);
  });
  it('falls back to UTC for unknown zones', () => {
    expect(cronIsDue('0 0 * * *', new Date('2026-03-10T00:00:00Z'), 'Mars/Phobos')).toBe(true);
  });
});

describe('templates', () => {
  const ctx = {
    trigger: { payload: { leadId: 'L1', tags: ['a', 'b'], n: 5, nested: { x: null } } },
    steps: { s1: { output: { text: 'hello' } } },
  };
  it('renders paths, indexes and objects', () => {
    expect(renderTemplate('Lead {{ trigger.payload.leadId }}!', ctx)).toBe('Lead L1!');
    expect(renderTemplate('{{trigger.payload.tags[1]}}', ctx)).toBe('b');
    expect(renderTemplate('{{ steps.s1.output.text }} / {{ trigger.payload.n }}', ctx)).toBe(
      'hello / 5',
    );
    expect(renderTemplate('{{ trigger.payload.tags }}', ctx)).toBe('["a","b"]');
  });
  it('renders missing values as empty and ignores unsafe paths', () => {
    expect(renderTemplate('[{{ trigger.payload.nope }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ trigger.payload.nested.x }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ __proto__.polluted }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ trigger.constructor.name }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ trigger.toString }}]', ctx)).toBe('[]');
    expect(renderTemplate('[{{ a b }}]', ctx)).toBe('[]');
  });
  it('does not evaluate code', () => {
    expect(renderTemplate('{{ process.exit() }}', ctx)).toBe('');
    expect(renderTemplate('{{ 1+1 }}', ctx)).toBe('');
  });
  it('renderTemplateValue keeps types for single expressions', () => {
    expect(renderTemplateValue('{{ trigger.payload.n }}', ctx)).toBe(5);
    expect(renderTemplateValue('n={{ trigger.payload.n }}', ctx)).toBe('n=5');
  });
  it('renderDeep walks objects/arrays', () => {
    expect(
      renderDeep({ a: ['{{ trigger.payload.leadId }}'], b: { c: 1 }, __proto__: null }, ctx),
    ).toEqual({
      a: ['L1'],
      b: { c: 1 },
    });
  });
  it('resolvePath refuses non-own properties', () => {
    expect(resolvePath({ a: 1 }, 'a')).toBe(1);
    expect(resolvePath({}, 'toString')).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  it('eq/neq compare numerically when both numeric', () => {
    expect(evaluateCondition('5', 'eq', '5.0')).toBe(true);
    expect(evaluateCondition('abc', 'eq', 'abc')).toBe(true);
    expect(evaluateCondition('abc', 'neq', 'abd')).toBe(true);
  });
  it('gt/lt need numbers', () => {
    expect(evaluateCondition('10', 'gt', '9')).toBe(true);
    expect(evaluateCondition('a', 'gt', '9')).toBe(false);
    expect(evaluateCondition('1', 'lt', '2')).toBe(true);
  });
  it('contains is case-insensitive; exists checks emptiness', () => {
    expect(evaluateCondition('Hello World', 'contains', 'world')).toBe(true);
    expect(evaluateCondition('', 'exists')).toBe(false);
    expect(evaluateCondition('x', 'exists')).toBe(true);
    expect(evaluateCondition('null', 'exists')).toBe(false);
  });
});

describe('validateWorkflowDefinition', () => {
  const note: WorkflowStep = {
    id: 'n1',
    type: 'create_lead_note',
    leadId: '{{ trigger.payload.leadId }}',
    body: 'hi',
  };
  it('accepts a valid definition', () => {
    expect(validateWorkflowDefinition({ type: 'event', event: 'lead.created' }, [note])).toEqual(
      [],
    );
  });
  it('flags duplicate ids, bad cron and unknown roots', () => {
    const issues = validateWorkflowDefinition({ type: 'schedule', cron: '99 * * * *' }, [
      note,
      { ...note, body: '{{ weird.x }}' },
    ]);
    const messages = issues.map((i) => i.message).join('|');
    expect(messages).toContain('out of range');
    expect(messages).toContain('Duplicate step id');
    expect(messages).toContain('Unknown template root');
  });
  it('validates condition branches (unknown, backwards, overlapping)', () => {
    const steps: WorkflowStep[] = [
      note,
      {
        id: 'c',
        type: 'condition',
        left: '1',
        operator: 'eq',
        right: '1',
        then: ['n1', 'zz', 'd'],
        else: ['d'],
      },
      { id: 'd', type: 'delay', seconds: 5 },
    ];
    const msgs = validateWorkflowDefinition({ type: 'manual' }, steps).map((i) => i.message);
    expect(msgs.some((m) => m.includes('Unknown step id "zz"'))).toBe(true);
    expect(msgs.some((m) => m.includes('must come after'))).toBe(true);
    expect(msgs.some((m) => m.includes('both branches'))).toBe(true);
  });
  it('validates step output references', () => {
    const steps: WorkflowStep[] = [
      { ...note, body: '{{ steps.later.output.x }}' },
      { id: 'later', type: 'set_variable', name: 'x', value: '1' },
    ];
    const msgs = validateWorkflowDefinition({ type: 'manual' }, steps).map((i) => i.message);
    expect(msgs.some((m) => m.includes('runs later'))).toBe(true);
  });
  it('checks http urls, update_lead emptiness, outbound events, variable names, unbalanced templates', () => {
    const steps: WorkflowStep[] = [
      {
        id: 'h',
        type: 'http_request',
        method: 'GET',
        url: 'http://example.com',
        headers: {},
        timeoutMs: 1000,
      },
      { id: 'u', type: 'update_lead', leadId: 'x', addTags: [] },
      { id: 'o', type: 'outbound_webhook', event: 'custom.thing', payload: {} },
      { id: 'v', type: 'set_variable', name: '1bad', value: 'x' },
      { id: 'b', type: 'create_lead_note', leadId: 'x', body: '{{ trigger.payload' },
    ];
    const msgs = validateWorkflowDefinition({ type: 'manual' }, steps).map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringContaining('https://'),
        expect.stringContaining('at least one of'),
        expect.stringContaining('not a known event'),
        expect.stringContaining('Variable names'),
        expect.stringContaining('Unbalanced'),
      ]),
    );
  });
  it('caps total delay', () => {
    const steps: WorkflowStep[] = Array.from({ length: 9 }, (_, i) => ({
      id: `d${i}`,
      type: 'delay' as const,
      seconds: 86_400,
    }));
    expect(
      validateWorkflowDefinition({ type: 'manual' }, steps).some((i) =>
        i.message.includes('7 days'),
      ),
    ).toBe(true);
  });
});
