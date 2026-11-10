import type { Metadata } from 'next';
import { AnalyticsView } from './analytics-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.analytics') };
}

export default function AnalyticsPage() {
  return <AnalyticsView />;
}
