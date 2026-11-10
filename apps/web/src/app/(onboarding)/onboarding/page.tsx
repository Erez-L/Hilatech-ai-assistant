import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OnboardingForm } from './onboarding-form';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.createYourOrganization') };
}

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingForm />
    </Suspense>
  );
}
