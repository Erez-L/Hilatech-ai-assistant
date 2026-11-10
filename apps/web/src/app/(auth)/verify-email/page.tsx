import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmail } from './verify-email';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.verifyEmail') };
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
