import type { Metadata } from 'next';
import { AgentsView } from './agents-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.agents') };
}

export default function AgentsPage() {
  return <AgentsView />;
}
