import { ErrorCode, loginSchema, paginationQuerySchema } from '@hilatech/contracts';

import { AppException } from '../errors/app.exception';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  it('returns the parsed (transformed) value on success', () => {
    const pipe = new ZodValidationPipe(loginSchema);
    expect(pipe.transform({ email: '  Owner@Demo.LOCAL ', password: 'x' })).toEqual({
      email: 'owner@demo.local',
      password: 'x',
    });
  });

  it('applies defaults and coercion for query schemas', () => {
    const pipe = new ZodValidationPipe(paginationQuerySchema);
    expect(pipe.transform(undefined)).toEqual({ page: 1, pageSize: 20 });
    expect(pipe.transform({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('throws 400 VALIDATION_ERROR with issue paths and messages in details', () => {
    const pipe = new ZodValidationPipe(loginSchema);
    let error: AppException | undefined;
    try {
      pipe.transform({ email: 'nope' });
    } catch (e) {
      error = e as AppException;
    }
    expect(error).toBeInstanceOf(AppException);
    expect(error!.getStatus()).toBe(400);
    expect(error!.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error!.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'email', code: 'invalid_format' }),
        expect.objectContaining({ path: 'password', code: 'invalid_type' }),
      ]),
    );
  });

  it('rejects unknown keys for strict schemas and enforces bounds', () => {
    const pipe = new ZodValidationPipe(paginationQuerySchema);
    expect(() => pipe.transform({ pageSize: '1000' })).toThrow(AppException);
  });
});
