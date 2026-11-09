/** Only allow same-origin relative paths as post-login destinations (prevents open redirects). */
export function safeNextPath(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('://')) return fallback;
  return value;
}
