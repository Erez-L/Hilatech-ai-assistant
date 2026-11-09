import type { Metadata } from 'next';
import { Sparkles } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Assistant' };

export default function AssistantPage() {
  return (
    <UpcomingFeature
      title="Assistant"
      description="Chat with an assistant that knows your business and can act inside it."
      icon={Sparkles}
      milestone="AI platform"
      capabilities={[
        'Answers grounded in your organization’s knowledge base and settings.',
        'Tools that create leads, book follow-ups and look up records — with permission checks.',
        'Streaming responses with the sources used for each answer.',
        'Usage tracked against your plan’s token allowance.',
      ]}
    />
  );
}
