import { ErrorCode, apiErrorSchema, paginationMetaSchema } from '@hilatech/contracts';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { type SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { type ZodObject, type ZodRawShape, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Swagger documentation derived from the zod contracts (ADR-007): the same schema validates the
 * request and documents it, so the OpenAPI document can never drift from what the API enforces.
 */
export function zodToOpenApi(schema: ZodTypeAny): SchemaObject {
  // The library's conditional return type is too deep for tsc with arbitrary schemas; we only need the plain object.
  const convert = zodToJsonSchema as unknown as (
    s: ZodTypeAny,
    o: { target: string; $refStrategy: string },
  ) => Record<string, unknown>;
  const json = convert(schema, { target: 'openApi3', $refStrategy: 'none' });
  delete json.$schema;
  return json as SchemaObject;
}

const PAGINATION_META = zodToOpenApi(paginationMetaSchema);
const ERROR_ENVELOPE = zodToOpenApi(apiErrorSchema);

export function ApiZodBody(schema: ZodTypeAny, description?: string): MethodDecorator {
  return ApiBody({ schema: zodToOpenApi(schema), description });
}

/** Documents each top-level key of an object schema as a query parameter. */
export function ApiZodQuery(schema: ZodObject<ZodRawShape>): MethodDecorator {
  const decorators: MethodDecorator[] = [];
  for (const [name, field] of Object.entries(schema.shape)) {
    const required = !field.isOptional();
    decorators.push(ApiQuery({ name, required, schema: zodToOpenApi(field) }));
  }
  return applyDecorators(...decorators);
}

export interface ApiZodResponseOptions {
  status?: number;
  description?: string;
  /** Wrap the item schema in an array and add `meta: PaginationMeta`. */
  paginated?: boolean;
}

/** Documents a success response in the `{ data, meta? }` envelope. Pass `null` for empty (204) responses. */
export function ApiZodResponse(
  schema: ZodTypeAny | null,
  options: ApiZodResponseOptions = {},
): MethodDecorator {
  const status = options.status ?? (schema === null ? HttpStatus.NO_CONTENT : HttpStatus.OK);
  if (schema === null) {
    return ApiResponse({ status, description: options.description ?? 'No content' });
  }
  const dataSchema = zodToOpenApi(schema);
  const envelope: SchemaObject = {
    type: 'object',
    required: ['data'],
    properties: {
      data: options.paginated ? { type: 'array', items: dataSchema } : dataSchema,
      ...(options.paginated ? { meta: PAGINATION_META } : {}),
    },
  };
  return ApiResponse({ status, description: options.description ?? 'Success', schema: envelope });
}

/** Documents the error envelope for the given statuses with the codes they can carry. */
export function ApiErrors(
  ...entries: Array<[status: number, ...codes: ErrorCode[]]>
): MethodDecorator {
  return applyDecorators(
    ...entries.map(([status, ...codes]) =>
      ApiResponse({
        status,
        description: codes.length ? `Error codes: ${codes.join(', ')}` : 'Error',
        schema: ERROR_ENVELOPE,
      }),
    ),
  );
}

export const COMMON_AUTH_ERRORS: Array<[number, ...ErrorCode[]]> = [
  [
    HttpStatus.UNAUTHORIZED,
    ErrorCode.UNAUTHORIZED,
    ErrorCode.TOKEN_EXPIRED,
    ErrorCode.TOKEN_INVALID,
  ],
];

export const COMMON_TENANT_ERRORS: Array<[number, ...ErrorCode[]]> = [
  ...COMMON_AUTH_ERRORS,
  [HttpStatus.BAD_REQUEST, ErrorCode.ORGANIZATION_REQUIRED, ErrorCode.VALIDATION_ERROR],
  [HttpStatus.FORBIDDEN, ErrorCode.NOT_A_MEMBER, ErrorCode.FORBIDDEN],
];
