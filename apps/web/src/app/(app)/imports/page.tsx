import type { Metadata } from 'next';
import { ImportsView } from './imports-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.imports') };
}

export default function ImportsPage() {
  return <ImportsView />;
}
