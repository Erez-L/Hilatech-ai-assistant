import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DealsView } from './deals-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.deals') };
}

export default function DealsPage() {
  return (
    <Suspense>
      <DealsView />
    </Suspense>
  );
}
