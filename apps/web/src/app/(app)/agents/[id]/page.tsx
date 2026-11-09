import type { Metadata } from 'next';
import { AgentEditor } from '../agent-editor';

export const metadata: Metadata = { title: 'Agent' };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AgentEditor id={id} />;
}
