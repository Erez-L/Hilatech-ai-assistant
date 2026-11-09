import type { Metadata } from 'next';
import { BaseDetailView } from './base-detail-view';

export const metadata: Metadata = { title: 'Knowledge base' };

export default async function KnowledgeBasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BaseDetailView id={id} />;
}
