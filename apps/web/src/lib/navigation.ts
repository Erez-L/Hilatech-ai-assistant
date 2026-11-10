/**
 * True for an app-relative path that browsers resolve on the SAME origin. Rejects `//host`, backslash forms
 * (`/\host` is normalised to `//host` by browsers), control characters (tab/newline are stripped by URL parsers)
 * and anything that leaves the origin once parsed. Keep in sync with `isSafeAppPath` in `@hilatech/shared`.
 */
export function isSafeAppPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    return new URL(value, 'http://app.invalid').origin === 'http://app.invalid';
  } catch {
    return false;
  }
}

/** Only allow same-origin relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  return isSafeAppPath(value) ? value : fallback;
}
