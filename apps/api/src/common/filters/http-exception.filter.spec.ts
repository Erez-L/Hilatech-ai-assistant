import { ErrorCode } from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';

import { AppException } from '../errors/app.exception';
import { toErrorEnvelope } from './http-exception.filter';

describe('toErrorEnvelope', () => {
  it('renders AppException with its code, message, details and requestId', () => {
    const { status, body } = toErrorEnvelope(
      AppException.validation('Validation failed', [{ path: 'email' }]),
      'req-1',
    );
    expect(status).toBe(400);
    expect(body).toEqual({
      error: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: [{ path: 'email' }],
        requestId: 'req-1',
      },
    });
  });

  it('maps standard Nest exceptions by status', () => {
    expect(toErrorEnvelope(new NotFoundException('Cannot GET /x')).body.error).toMatchObject({
      code: ErrorCode.NOT_FOUND,
      message: 'Cannot GET /x',
    });
    expect(toErrorEnvelope(new ForbiddenException()).body.error.code).toBe(ErrorCode.FORBIDDEN);
    expect(
      toErrorEnvelope(new BadRequestException('Unexpected token in JSON at position 1')).body.error,
    ).toEqual({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Malformed JSON body',
    });
  });

  it('maps throttling to 429 RATE_LIMITED', () => {
    const { status, body } = toErrorEnvelope(new ThrottlerException());
    expect(status).toBe(429);
    expect(body.error.code).toBe(ErrorCode.RATE_LIMITED);
  });

  it('maps Prisma unique violations to 409 and missing records to 404', () => {
    const unique = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const missing = new Prisma.PrismaClientKnownRequestError('missing', {
      code: 'P2025',
      clientVersion: 'x',
    });
    expect(toErrorEnvelope(unique).status).toBe(409);
    expect(toErrorEnvelope(unique).body.error.code).toBe(ErrorCode.CONFLICT);
    expect(toErrorEnvelope(missing).status).toBe(404);
  });

  it('maps body-parser size errors to 413 PAYLOAD_TOO_LARGE', () => {
    const err = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
      expose: true,
    });
    const { status, body } = toErrorEnvelope(err);
    expect(status).toBe(413);
    expect(body.error).toEqual({
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: 'Request body too large',
    });
  });

  it('never leaks internal error messages or stack traces for unexpected errors', () => {
    const { status, body } = toErrorEnvelope(
      new Error('connection string postgres://user:secret@host'),
      'req-9',
    );
    expect(status).toBe(500);
    expect(body).toEqual({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        requestId: 'req-9',
      },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('redacts sensitive keys inside details', () => {
    const { body } = toErrorEnvelope(
      AppException.validation('x', { password: 'hunter2', nested: { apiKey: 'k' } }),
    );
    expect(body.error.details).toEqual({
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]' },
    });
  });

  it('keeps 5xx HttpExceptions generic', () => {
    const { body } = toErrorEnvelope(
      new AppException(HttpStatus.GATEWAY_TIMEOUT, ErrorCode.INTERNAL_ERROR, 'Request timed out'),
    );
    expect(body.error.message).toBe('Request timed out');
  });
});
