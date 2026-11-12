import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RunView } from './run-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.evaluations') };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <RunView id={id} />
    </Suspense>
  );
}
