import type { Metadata } from 'next';
import { ExecutionsView } from './executions-view';

export const metadata: Metadata = { title: 'Workflow executions' };

export default function WorkflowExecutionsPage() {
  return <ExecutionsView />;
}
