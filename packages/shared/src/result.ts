/** Minimal discriminated Result type for services that prefer explicit failures over exceptions. */
export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Exhaustiveness helper for switch statements. */
export function assertNever(x: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(x)}`);
}
