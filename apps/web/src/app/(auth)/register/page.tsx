import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from './register-form';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.createAccount') };
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
