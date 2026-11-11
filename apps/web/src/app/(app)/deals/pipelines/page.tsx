import type { Metadata } from 'next';
import { PipelinesView } from './pipelines-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.pipelines') };
}

export default function PipelinesPage() {
  return <PipelinesView />;
}
