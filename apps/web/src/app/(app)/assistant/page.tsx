import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AssistantView } from './assistant-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.assistant') };
}

export default function AssistantPage() {
  return (
    <Suspense>
      <AssistantView />
    </Suspense>
  );
}
