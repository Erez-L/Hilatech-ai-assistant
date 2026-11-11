import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TasksView } from './tasks-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.tasks') };
}

export default function TasksPage() {
  return (
    <Suspense>
      <TasksView />
    </Suspense>
  );
}
