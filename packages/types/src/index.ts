/** JSON-compatible value. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Request-scoped tenant context resolved by the API from the authenticated user + validated membership. */
export interface TenantContext {
  organizationId: string;
  userId: string;
  memberId: string;
  roleId: string;
  roleKey: string;
  permissions: readonly string[];
}

/** Authenticated principal (user-scoped; organization is selected per request). */
export interface Principal {
  userId: string;
  email: string;
  sessionId: string;
  /** Whether the account's email address has been verified. */
  emailVerified: boolean;
}

export type Nullable<T> = T | null;
export type Maybe<T> = T | null | undefined;
export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
