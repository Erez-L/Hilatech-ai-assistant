import type { Metadata } from 'next';
import { AgentEditor } from '../agent-editor';

export const metadata: Metadata = { title: 'New agent' };

export default function NewAgentPage() {
  return <AgentEditor />;
}
