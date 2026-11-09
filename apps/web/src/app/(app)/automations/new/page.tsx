import type { Metadata } from 'next';
import { NewWorkflowView } from './new-workflow-view';

export const metadata: Metadata = { title: 'New workflow' };

export default function NewWorkflowPage() {
  return <NewWorkflowView />;
}
