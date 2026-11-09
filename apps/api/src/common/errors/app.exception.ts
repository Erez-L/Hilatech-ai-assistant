import { ErrorCode } from '@hilatech/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Application exception carrying a stable machine-readable `code` (from `ErrorCode` in contracts).
 * `HttpExceptionFilter` renders it as `{ error: { code, message, details?, requestId } }`.
 */
export class AppException extends HttpException {
  constructor(
    httpStatus: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, httpStatus);
  }

  static validation(message = 'Validation failed', details?: unknown): AppException {
    return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, details);
  }

  static unauthorized(
    message = 'Authentication required',
    code: ErrorCode = ErrorCode.UNAUTHORIZED,
  ): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, code, message);
  }

  static forbidden(
    message = 'You do not have permission to perform this action',
    details?: unknown,
  ): AppException {
    return new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, message, details);
  }

  static notFound(resource = 'Resource'): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${resource} not found`);
  }

  static conflict(message: string, details?: unknown): AppException {
    return new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message, details);
  }

  static organizationRequired(
    message = 'An organization must be selected (x-organization-id header)',
  ): AppException {
    return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.ORGANIZATION_REQUIRED, message);
  }

  static notAMember(): AppException {
    return new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.NOT_A_MEMBER,
      'You are not an active member of this organization',
    );
  }

  static entitlementExceeded(message: string, details?: unknown): AppException {
    return new AppException(
      HttpStatus.PAYMENT_REQUIRED,
      ErrorCode.ENTITLEMENT_EXCEEDED,
      message,
      details,
    );
  }

  static rateLimited(): AppException {
    return new AppException(
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCode.RATE_LIMITED,
      'Too many requests, please try again later',
    );
  }
}
