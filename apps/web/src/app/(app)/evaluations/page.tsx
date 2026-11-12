import type { Metadata } from 'next';
import { Suspense } from 'react';
import { EvaluationsView } from './evaluations-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.evaluations') };
}

export default function Page() {
  return (
    <Suspense>
      <EvaluationsView />
    </Suspense>
  );
}
