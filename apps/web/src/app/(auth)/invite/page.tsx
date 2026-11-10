import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InviteAccept } from './invite-accept';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.invitation') };
}

export default function InvitePage() {
  return (
    <Suspense>
      <InviteAccept />
    </Suspense>
  );
}
