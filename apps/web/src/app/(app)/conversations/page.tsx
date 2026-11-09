import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConversationsView } from './conversations-view';

export const metadata: Metadata = { title: 'Conversations' };

export default function ConversationsPage() {
  return (
    <Suspense>
      <ConversationsView />
    </Suspense>
  );
}
