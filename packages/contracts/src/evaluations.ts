import { z } from 'zod';

import { idSchema, paginationQuerySchema, timestampsSchema } from './common';

/**
 * Agent evaluation: a dataset is a list of cases (an input plus deterministic checks on the agent's
 * answer); a run executes one agent against every case and records pass/fail per case, so a prompt
 * or model change can be compared with an earlier run.
 */
export const EVALUATION_LIMITS = {
  maxCasesPerDataset: 50,
  maxChecksPerCase: 10,
} as const;

export const EvaluationCheckType = z.enum(['contains', 'not_contains', 'equals', 'regex']);
export type EvaluationCheckType = z.infer<typeof EvaluationCheckType>;

export const evaluationCheckSchema = z.object({
  type: EvaluationCheckType,
  /** Text to look for (case-insensitive), the exact expected answer, or a regular expression source. */
  value: z.string().min(1).max(2000),
});
export type EvaluationCheck = z.infer<typeof evaluationCheckSchema>;

const checksSchema = z
  .array(evaluationCheckSchema)
  .min(1)
  .max(EVALUATION_LIMITS.maxChecksPerCase)
  .superRefine((checks, ctx) => {
    checks.forEach((check, index) => {
      if (check.type !== 'regex') return;
      try {
        new RegExp(check.value, 'i');
      } catch {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'value'],
          message: 'Invalid regular expression',
        });
      }
    });
  });

export const evaluationCaseSchema = z.object({
  id: idSchema,
  datasetId: idSchema,
  name: z.string(),
  input: z.string(),
  checks: z.array(evaluationCheckSchema),
  position: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EvaluationCase = z.infer<typeof evaluationCaseSchema>;

export const createEvaluationCaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  input: z.string().trim().min(1).max(20_000),
  checks: checksSchema,
});
export type CreateEvaluationCaseRequest = z.infer<typeof createEvaluationCaseSchema>;
export const updateEvaluationCaseSchema = createEvaluationCaseSchema.partial();
export type UpdateEvaluationCaseRequest = z.infer<typeof updateEvaluationCaseSchema>;

export const evaluationDatasetSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    description: z.string().nullable(),
    caseCount: z.number().int(),
    lastRun: z
      .object({
        id: idSchema,
        status: z.string(),
        passed: z.number().int(),
        total: z.number().int(),
        finishedAt: z.string().datetime().nullable(),
      })
      .nullable(),
  })
  .merge(timestampsSchema);
export type EvaluationDataset = z.infer<typeof evaluationDatasetSchema>;

export const evaluationDatasetDetailSchema = evaluationDatasetSchema.extend({
  cases: z.array(evaluationCaseSchema),
});
export type EvaluationDatasetDetail = z.infer<typeof evaluationDatasetDetailSchema>;

export const createEvaluationDatasetSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export type CreateEvaluationDatasetRequest = z.infer<typeof createEvaluationDatasetSchema>;
export const updateEvaluationDatasetSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).nullable(),
  })
  .partial();
export type UpdateEvaluationDatasetRequest = z.infer<typeof updateEvaluationDatasetSchema>;

export const EvaluationRunStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type EvaluationRunStatus = z.infer<typeof EvaluationRunStatus>;
export const EvaluationResultStatus = z.enum(['passed', 'failed', 'error']);
export type EvaluationResultStatus = z.infer<typeof EvaluationResultStatus>;

export const evaluationRunSchema = z.object({
  id: idSchema,
  datasetId: idSchema,
  datasetName: z.string(),
  agentId: idSchema,
  agentName: z.string(),
  status: EvaluationRunStatus,
  totalCases: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  errored: z.number().int(),
  /** passed / totalCases as a percentage (null until the run finished or when it has no cases). */
  passRate: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export const evaluationCheckResultSchema = evaluationCheckSchema.extend({ passed: z.boolean() });
export type EvaluationCheckResult = z.infer<typeof evaluationCheckResultSchema>;

export const evaluationResultSchema = z.object({
  id: idSchema,
  caseId: idSchema.nullable(),
  caseName: z.string(),
  input: z.string(),
  status: EvaluationResultStatus,
  output: z.string().nullable(),
  error: z.string().nullable(),
  checks: z.array(evaluationCheckResultSchema),
  executionId: idSchema.nullable(),
  durationMs: z.number().int().nullable(),
});
export type EvaluationResult = z.infer<typeof evaluationResultSchema>;

export const evaluationRunDetailSchema = evaluationRunSchema.extend({
  results: z.array(evaluationResultSchema),
});
export type EvaluationRunDetail = z.infer<typeof evaluationRunDetailSchema>;

export const startEvaluationRunSchema = z.object({ agentId: idSchema });
export type StartEvaluationRunRequest = z.infer<typeof startEvaluationRunSchema>;

export const listEvaluationRunsQuerySchema = paginationQuerySchema.extend({
  datasetId: idSchema.optional(),
  agentId: idSchema.optional(),
});
export type ListEvaluationRunsQuery = z.infer<typeof listEvaluationRunsQuerySchema>;

// ---------------------------------------------------------------------------
// Scoring (pure; shared by the workers and the tests)
// ---------------------------------------------------------------------------

const normalise = (text: string): string => text.trim().replace(/\s+/g, ' ').toLowerCase();

/** Evaluates one check against the agent's answer. Text checks ignore case and repeated whitespace. */
export function evaluateCheck(check: EvaluationCheck, output: string): boolean {
  switch (check.type) {
    case 'contains':
      return normalise(output).includes(normalise(check.value));
    case 'not_contains':
      return !normalise(output).includes(normalise(check.value));
    case 'equals':
      return normalise(output) === normalise(check.value);
    case 'regex':
      try {
        return new RegExp(check.value, 'i').test(output);
      } catch {
        return false;
      }
    default: {
      const exhaustive: never = check.type;
      return exhaustive;
    }
  }
}

/** A case passes only when every check passes. */
export function scoreEvaluationCase(
  checks: readonly EvaluationCheck[],
  output: string,
): { passed: boolean; checks: EvaluationCheckResult[] } {
  const results = checks.map((check) => ({ ...check, passed: evaluateCheck(check, output) }));
  return { passed: results.length > 0 && results.every((r) => r.passed), checks: results };
}
