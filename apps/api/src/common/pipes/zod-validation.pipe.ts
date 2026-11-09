import { Injectable, type PipeTransform } from '@nestjs/common';
import { type ZodTypeAny, type z } from 'zod';

import { AppException } from '../errors/app.exception';

/**
 * Validates and transforms a body/query/param with a zod schema from `@hilatech/contracts`.
 * Failures become `400 VALIDATION_ERROR` with the zod issues (path, message, code) in `details`.
 */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<
  unknown,
  z.output<S>
> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw AppException.validation(
        'Validation failed',
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      );
    }
    return result.data;
  }
}
