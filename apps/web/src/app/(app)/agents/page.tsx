import type { Metadata } from 'next';
import { Bot } from 'lucide-react';
import { UpcomingFeature } from '@/components/common/upcoming-feature';

export const metadata: Metadata = { title: 'Agents' };

export default function AgentsPage() {
  return (
    <UpcomingFeature
      title="Agents"
      description="Configure autonomous agents with clear goals, tools and limits."
      icon={Bot}
      milestone="AI platform"
      capabilities={[
        'Agents with a purpose, instructions, allowed tools and a model choice per organization.',
        'Hard limits on steps, duration, tokens and delegation depth for every run.',
        'Run history with each step, tool call and outcome, so nothing is a black box.',
        'Permission checks before every action an agent takes.',
      ]}
    />
  );
}
