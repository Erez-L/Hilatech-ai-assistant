import type { Metadata } from 'next';
import { ExecutionDetailView } from './execution-detail-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.workflowExecution') };
}

export default async function WorkflowExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExecutionDetailView id={id} />;
}
