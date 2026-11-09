import type { Metadata } from 'next';
import { Target } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Leads' };

export default function LeadsPage() {
  return (
    <UpcomingFeature
      title="Leads"
      description="Capture, qualify and move every enquiry through your pipeline."
      icon={Target}
      milestone="Core business"
      capabilities={[
        'Leads from the website, WhatsApp, email, referrals and the assistant itself, each with a source and a value.',
        'Stages from new to won or lost, with notes and an activity timeline per lead.',
        'Assignment to teammates and conversion of a lead into a contact in one step.',
        'Filtering and search across status, source, owner and date.',
      ]}
    />
  );
}
