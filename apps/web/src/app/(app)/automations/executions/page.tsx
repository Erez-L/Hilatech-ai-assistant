import type { Metadata } from 'next';
import { ExecutionsView } from './executions-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.workflowExecutions') };
}

export default function WorkflowExecutionsPage() {
  return <ExecutionsView />;
}
