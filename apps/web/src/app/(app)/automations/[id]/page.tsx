import type { Metadata } from 'next';
import { WorkflowDetailView } from './workflow-detail-view';

export const metadata: Metadata = { title: 'Workflow' };

export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowDetailView id={id} />;
}
