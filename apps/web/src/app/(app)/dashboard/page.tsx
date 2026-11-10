import type { Metadata } from 'next';
import { DashboardView } from './dashboard-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.dashboard') };
}

export default function DashboardPage() {
  return <DashboardView />;
}
