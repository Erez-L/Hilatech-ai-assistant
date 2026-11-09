import type { Metadata } from 'next';
import { AiSettingsView } from './ai-settings-view';

export const metadata: Metadata = { title: 'AI settings' };

export default function AiSettingsPage() {
  return <AiSettingsView />;
}
