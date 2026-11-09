import type { Metadata } from 'next';
import { BookOpen } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Knowledge' };

export default function KnowledgePage() {
  return (
    <UpcomingFeature
      title="Knowledge"
      description="Documents and FAQs that ground the assistant in your business."
      icon={BookOpen}
      milestone="Knowledge & automation"
      capabilities={[
        'Upload PDFs, documents and text; processing happens in the background.',
        'Chunking and embeddings for retrieval, with status per document.',
        'Knowledge bases you can scope to specific agents.',
        'Storage and document counts tracked against your plan.',
      ]}
    />
  );
}
