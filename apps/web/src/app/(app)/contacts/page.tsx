import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ContactsView } from './contacts-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.contacts') };
}

export default function ContactsPage() {
  return (
    <Suspense>
      <ContactsView />
    </Suspense>
  );
}
