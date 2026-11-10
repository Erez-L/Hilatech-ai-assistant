import type { Metadata } from 'next';
import { TemplatesView } from './templates-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.workflowTemplates') };
}

export default function TemplatesPage() {
  return <TemplatesView />;
}
