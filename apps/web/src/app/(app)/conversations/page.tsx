import type { Metadata } from 'next';
import { MessageSquare } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Conversations' };

export default function ConversationsPage() {
  return (
    <UpcomingFeature
      title="Conversations"
      description="Every exchange between your business, your customers and the assistant."
      icon={MessageSquare}
      milestone="Core business"
      capabilities={[
        'A shared inbox for conversations handled by the assistant and by people.',
        'Hand-over from the assistant to a teammate, with the full context attached.',
        'Assignment, status and the contact or lead each conversation belongs to.',
        'Message history with who — or what — said each thing.',
      ]}
    />
  );
}
