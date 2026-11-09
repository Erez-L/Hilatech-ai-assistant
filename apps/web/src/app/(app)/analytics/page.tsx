import type { Metadata } from 'next';
import { BarChart3 } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return (
    <UpcomingFeature
      title="Analytics"
      description="Trends over time for leads, conversations and assistant usage."
      icon={BarChart3}
      milestone="Commercial"
      capabilities={[
        'Lead volume and conversion by source and stage.',
        'Conversation volume, response times and assistant hand-over rate.',
        'AI usage over time against your plan.',
        'Exports for the numbers you report elsewhere.',
      ]}
    />
  );
}
