import { idSchema } from '@hilatech/contracts';
import { Injectable, type PipeTransform } from '@nestjs/common';

import { AppException } from '../errors/app.exception';

/** Validates a path parameter as UUID → otherwise `400 VALIDATION_ERROR`. */
@Injectable()
export class UuidPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    const result = idSchema.safeParse(value);
    if (!result.success) {
      throw AppException.validation('Invalid identifier', [
        { path: 'id', message: 'Expected a UUID', code: 'invalid_format' },
      ]);
    }
    return result.data;
  }
}
