import type { Metadata } from 'next';
import { Contact } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Contacts' };

export default function ContactsPage() {
  return (
    <UpcomingFeature
      title="Contacts"
      description="The people and companies your business talks to."
      icon={Contact}
      milestone="Core business"
      capabilities={[
        'Contacts with company, job title, tags and custom fields that fit your business.',
        'Ownership per contact so everyone knows who holds the relationship.',
        'Links from each contact to their leads and conversations.',
        'Search and tag filters across the whole address book.',
      ]}
    />
  );
}
