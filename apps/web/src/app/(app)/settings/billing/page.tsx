import type { Metadata } from 'next';
import { BillingView } from './billing-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.billing') };
}

export default function BillingPage() {
  return <BillingView />;
}
