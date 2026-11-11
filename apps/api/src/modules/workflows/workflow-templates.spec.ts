import { validateWorkflowDefinition, workflowTemplateSchema } from '@hilatech/contracts';

import { PLACEHOLDER_ID, WORKFLOW_TEMPLATES } from './workflow-templates';

describe('workflow templates', () => {
  it('have unique keys and match the contract schema', () => {
    const keys = WORKFLOW_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of WORKFLOW_TEMPLATES) expect(() => workflowTemplateSchema.parse(t)).not.toThrow();
  });

  it('are structurally valid definitions', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      expect({ key: t.key, issues: validateWorkflowDefinition(t.trigger, t.steps) }).toEqual({
        key: t.key,
        issues: [],
      });
    }
  });

  it('declare what the user must fill in whenever they use the placeholder id', () => {
    for (const t of WORKFLOW_TEMPLATES) {
      if (JSON.stringify(t.steps).includes(PLACEHOLDER_ID))
        expect(t.requires.length).toBeGreaterThan(0);
    }
  });
});
