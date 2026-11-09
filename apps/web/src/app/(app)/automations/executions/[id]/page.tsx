import type { Metadata } from 'next';
import { ExecutionDetailView } from './execution-detail-view';

export const metadata: Metadata = { title: 'Workflow execution' };

export default async function WorkflowExecutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExecutionDetailView id={id} />;
}
