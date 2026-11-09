import { ErrorCode, REQUEST_ID_HEADER } from '@hilatech/contracts';
import { Prisma } from '@hilatech/database';
import { redactSensitive } from '@hilatech/shared';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { type Response } from 'express';
import { Logger } from 'nestjs-pino';

import { AppException } from '../errors/app.exception';
import { type AppRequest, requestIdOf } from '../request';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

const STATUS_TO_CODE: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.PAYMENT_REQUIRED]: ErrorCode.ENTITLEMENT_EXCEEDED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMITED,
};

/** Maps any thrown value to the standard error envelope. Pure function so it is unit-testable. */
export function toErrorEnvelope(
  exception: unknown,
  requestId?: string,
): { status: number; body: ErrorEnvelope } {
  let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let code: ErrorCode = ErrorCode.INTERNAL_ERROR;
  let message = 'Internal server error';
  let details: unknown;

  if (exception instanceof AppException) {
    status = exception.getStatus();
    code = exception.code;
    message = exception.message;
    details = exception.details;
  } else if (exception instanceof ThrottlerException) {
    status = HttpStatus.TOO_MANY_REQUESTS;
    code = ErrorCode.RATE_LIMITED;
    message = 'Too many requests, please try again later';
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    code =
      STATUS_TO_CODE[status] ??
      (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR);
    const response = exception.getResponse();
    if (typeof response === 'string') {
      message = response;
    } else if (response && typeof response === 'object') {
      const r = response as {
        message?: unknown;
        error?: unknown;
        code?: unknown;
        details?: unknown;
      };
      if (typeof r.code === 'string' && (Object.values(ErrorCode) as string[]).includes(r.code))
        code = r.code as ErrorCode;
      if (Array.isArray(r.message)) {
        message = 'Validation failed';
        details = r.message;
      } else if (typeof r.message === 'string') {
        message = r.message;
      } else if (typeof r.error === 'string') {
        message = r.error;
      }
      if (r.details !== undefined) details = r.details;
    }
    if (status >= 500) message = 'Internal server error';
    // Express body-parser JSON failures arrive as BadRequestException(parserMessage).
    if (status === HttpStatus.BAD_REQUEST && /JSON/i.test(message) && details === undefined)
      message = 'Malformed JSON body';
  } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') {
      status = HttpStatus.CONFLICT;
      code = ErrorCode.CONFLICT;
      message = 'A record with the same unique value already exists';
    } else if (exception.code === 'P2025') {
      status = HttpStatus.NOT_FOUND;
      code = ErrorCode.NOT_FOUND;
      message = 'Resource not found';
    }
  } else if (isBodyParserError(exception)) {
    status = exception.status;
    code = STATUS_TO_CODE[status] ?? ErrorCode.VALIDATION_ERROR;
    message =
      status === HttpStatus.PAYLOAD_TOO_LARGE
        ? 'Request body too large'
        : status === HttpStatus.UNSUPPORTED_MEDIA_TYPE
          ? 'Unsupported media type'
          : 'Malformed request body';
  }

  const body: ErrorEnvelope = { error: { code, message } };
  if (details !== undefined) body.error.details = redactSensitive(details);
  if (requestId) body.error.requestId = requestId;
  return { status, body };
}

function isTerminusResult(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    'status' in response &&
    'details' in response &&
    ('info' in response || 'error' in response)
  );
}

function isBodyParserError(e: unknown): e is { status: number; type?: string; message?: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { status?: unknown }).status === 'number' &&
    typeof (e as { type?: unknown }).type === 'string'
  );
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<AppRequest>();
    const res = ctx.getResponse<Response>();
    const requestId = requestIdOf(req);

    // Terminus readiness failures keep their native shape so probes read the same body on 200 and 503.
    if (exception instanceof HttpException && isTerminusResult(exception.getResponse())) {
      res.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const { status, body } = toErrorEnvelope(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, method: req.method, url: req.originalUrl ?? req.url },
        'Unhandled error',
        HttpExceptionFilter.name,
      );
    } else if (status === HttpStatus.FORBIDDEN || status === HttpStatus.UNAUTHORIZED) {
      this.logger.debug?.(
        { requestId, code: body.error.code, url: req.originalUrl ?? req.url },
        'Request rejected',
        HttpExceptionFilter.name,
      );
    }

    if (requestId && !res.getHeader(REQUEST_ID_HEADER)) res.setHeader(REQUEST_ID_HEADER, requestId);
    res.status(status).json(body);
  }
}
