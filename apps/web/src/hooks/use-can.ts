'use client';

import type { Permission } from '@hilatech/contracts';
import { useSession } from '@/stores/session';

/** True when the current session holds the permission in the active organization. */
export function useCan(permission: Permission | string): boolean {
  return useSession((s) => s.permissions.includes(permission));
}

/** True when the session holds every permission listed. */
export function useCanAll(...permissions: (Permission | string)[]): boolean {
  return useSession((s) => permissions.every((p) => s.permissions.includes(p)));
}

/** True when the session holds at least one of the permissions listed. */
export function useCanAny(...permissions: (Permission | string)[]): boolean {
  return useSession((s) => permissions.some((p) => s.permissions.includes(p)));
}
