import { z } from 'zod';

/**
 * JSON Schema (draft-07) for a zod schema, as sent to model providers for tool inputs and
 * structured output. `io: 'input'` describes what the model must send (fields with defaults stay
 * optional); types JSON Schema cannot express (dates, transforms) degrade to "any" instead of throwing.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    unrepresentable: 'any',
    reused: 'inline',
    // zod emits its full validation regex next to `format` (uuid, date-time): noise for the model, and
    // some providers reject long patterns. The executor re-validates the input with zod anyway.
    override: ({ jsonSchema }) => {
      if (jsonSchema.format !== undefined && jsonSchema.pattern !== undefined)
        delete jsonSchema.pattern;
    },
  }) as Record<string, unknown>;
}
