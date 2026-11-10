import type { Metadata } from 'next';
import { IntegrationsView } from './integrations-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.integrations') };
}

export default function IntegrationsPage() {
  return <IntegrationsView />;
}
