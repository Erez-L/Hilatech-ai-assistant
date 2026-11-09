import type { Metadata } from 'next';
import { ExecutionDetailView } from './execution-detail-view';

export const metadata: Metadata = { title: 'Agent run' };

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExecutionDetailView id={id} />;
}
