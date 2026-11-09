import type { Metadata } from 'next';
import { Plug } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return (
    <UpcomingFeature
      title="Integrations"
      description="Connect the channels and tools your business already uses."
      icon={Plug}
      milestone="Commercial"
      capabilities={[
        'Messaging channels, calendars, email and CRM connections.',
        'Outgoing webhooks with signed payloads and delivery logs.',
        'Credentials stored encrypted and never shown again after saving.',
        'A framework for adding new providers without changing the core.',
      ]}
    />
  );
}
