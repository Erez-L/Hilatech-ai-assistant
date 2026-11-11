import type { Metadata } from 'next';
import { ConversionReportView } from './conversion-report-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.dealsReport') };
}

export default function DealsReportPage() {
  return <ConversionReportView />;
}
