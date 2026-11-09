'use client';

import * as React from 'react';
import { ShieldOff } from 'lucide-react';
import { EmptyState } from '@hilatech/ui';
import { useCanAny } from '@/hooks/use-can';

/** Renders children only when the session holds one of the permissions; otherwise a clear notice. */
export function PermissionGate({
  anyOf,
  children,
  fallback,
}: {
  anyOf: string[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const allowed = useCanAny(...anyOf);
  if (allowed) return <>{children}</>;
  return (
    <>
      {fallback ?? (
        <EmptyState
          icon={<ShieldOff />}
          title="You don’t have access to this page"
          description="Ask an organization admin to grant your role the required permission."
        />
      )}
    </>
  );
}
