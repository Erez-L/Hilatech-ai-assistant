import type { Metadata } from 'next';
import { WorkflowsView } from './workflows-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.automations') };
}

export default function AutomationsPage() {
  return <WorkflowsView />;
}
