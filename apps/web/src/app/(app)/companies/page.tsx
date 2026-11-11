import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CompaniesView } from './companies-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.companies') };
}

export default function CompaniesPage() {
  return (
    <Suspense>
      <CompaniesView />
    </Suspense>
  );
}
