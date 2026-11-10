import type { Metadata } from 'next';
import { AiSettingsView } from './ai-settings-view';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.aiSettings') };
}

export default function AiSettingsPage() {
  return <AiSettingsView />;
}
