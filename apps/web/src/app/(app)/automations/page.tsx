import type { Metadata } from 'next';
import { Workflow } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Automations' };

export default function AutomationsPage() {
  return (
    <UpcomingFeature
      title="Automations"
      description="Routine follow-ups and hand-offs that run without anyone remembering."
      icon={Workflow}
      milestone="Knowledge & automation"
      capabilities={[
        'Triggers on events such as a new lead or a closed conversation.',
        'Actions like sending an email, notifying a teammate or calling a webhook.',
        'n8n integration for workflows that live outside the platform.',
        'Run history and failure notifications.',
      ]}
    />
  );
}
