import { describe, expect, it } from 'vitest';

import {
  updateAgentSchema,
  updateContactSchema,
  updateLeadSchema,
  updateWorkflowSchema,
} from '../index';

/**
 * Regression guard for the zod 4 upgrade: defaults declared on create schemas must never leak into
 * PATCH bodies (an omitted key has to stay absent, otherwise every update resets it).
 */
describe('update schemas do not apply create-time defaults', () => {
  it.each([
    ['lead', updateLeadSchema, { title: 'Renamed' }],
    ['contact', updateContactSchema, { firstName: 'Dana' }],
    ['agent', updateAgentSchema, { name: 'Renamed agent' }],
    ['workflow', updateWorkflowSchema, { name: 'Renamed workflow' }],
  ] as const)('%s: only the sent keys survive parsing', (_name, schema, body) => {
    const parsed = schema.parse(body) as Record<string, unknown>;
    const defined = Object.keys(parsed).filter((k) => parsed[k] !== undefined);
    expect(defined).toEqual(Object.keys(body));
  });

  it('an empty PATCH body parses to no defined keys', () => {
    const parsed = updateLeadSchema.parse({}) as Record<string, unknown>;
    expect(Object.values(parsed).filter((v) => v !== undefined)).toEqual([]);
  });
});
