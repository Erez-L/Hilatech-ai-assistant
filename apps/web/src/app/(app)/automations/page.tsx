import type { Metadata } from 'next';
import { WorkflowsView } from './workflows-view';

export const metadata: Metadata = { title: 'Automations' };

export default function AutomationsPage() {
  return <WorkflowsView />;
}
