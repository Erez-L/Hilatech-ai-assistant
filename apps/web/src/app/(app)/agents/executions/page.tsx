import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExecutionsView } from './executions-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.agentRuns') };
}

export default function ExecutionsPage() {
  return (
    <Suspense>
      <ExecutionsView />
    </Suspense>
  );
}
