import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExecutionsView } from './executions-view';

export const metadata: Metadata = { title: 'Agent runs' };

export default function ExecutionsPage() {
  return (
    <Suspense>
      <ExecutionsView />
    </Suspense>
  );
}
