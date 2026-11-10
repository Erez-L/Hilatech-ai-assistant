import type { Metadata } from 'next';
import { AgentEditor } from '../agent-editor';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t('meta.newAgent') };
}

export default function NewAgentPage() {
  return <AgentEditor />;
}
