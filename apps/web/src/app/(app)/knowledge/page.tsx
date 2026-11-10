import type { Metadata } from 'next';
import { KnowledgeView } from './knowledge-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.knowledge') };
}

export default function KnowledgePage() {
  return <KnowledgeView />;
}
