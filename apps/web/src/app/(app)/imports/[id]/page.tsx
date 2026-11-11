import type { Metadata } from 'next';
import { ImportDetailView } from './import-detail-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.import') };
}

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportDetailView id={id} />;
}
