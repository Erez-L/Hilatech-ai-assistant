import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InviteAccept } from './invite-accept';

export const metadata: Metadata = { title: 'Invitation' };

export default function InvitePage() {
  return (
    <Suspense>
      <InviteAccept />
    </Suspense>
  );
}
