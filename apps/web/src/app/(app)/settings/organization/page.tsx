import type { Metadata } from 'next';
import { OrganizationSettingsView } from './organization-settings-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.organizationSettings') };
}

export default function OrganizationSettingsPage() {
  return <OrganizationSettingsView />;
}
