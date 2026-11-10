import type { Metadata } from 'next';
import { ProfileSettingsView } from './profile-settings-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.yourProfile') };
}

export default function ProfileSettingsPage() {
  return <ProfileSettingsView />;
}
