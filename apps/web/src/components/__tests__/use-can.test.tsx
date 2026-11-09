import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Permission } from '@hilatech/contracts';
import { useCan, useCanAll, useCanAny } from '@/hooks/use-can';
import { useSession } from '@/stores/session';

describe('useCan', () => {
  beforeEach(() => {
    useSession.setState({ permissions: [Permission.MEMBERS_READ, Permission.ROLES_READ] });
  });

  it('reflects the session permissions', () => {
    expect(renderHook(() => useCan(Permission.MEMBERS_READ)).result.current).toBe(true);
    expect(renderHook(() => useCan(Permission.MEMBERS_INVITE)).result.current).toBe(false);
    expect(renderHook(() => useCanAll(Permission.MEMBERS_READ, Permission.ROLES_READ)).result.current).toBe(true);
    expect(renderHook(() => useCanAll(Permission.MEMBERS_READ, Permission.ORG_DELETE)).result.current).toBe(false);
    expect(renderHook(() => useCanAny(Permission.ORG_DELETE, Permission.ROLES_READ)).result.current).toBe(true);
  });
});
