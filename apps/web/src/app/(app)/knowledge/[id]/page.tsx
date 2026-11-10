import type { Metadata } from 'next';
import { BaseDetailView } from './base-detail-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.knowledgeBase') };
}

export default async function KnowledgeBasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BaseDetailView id={id} />;
}
