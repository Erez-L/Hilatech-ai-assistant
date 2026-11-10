import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConversationsView } from './conversations-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.conversations') };
}

export default function ConversationsPage() {
  return (
    <Suspense>
      <ConversationsView />
    </Suspense>
  );
}
