'use client';

import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { Button, EmptyState } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';

/** Shown when the organization has no usable AI provider (409 AI_NOT_CONFIGURED or no providers). */
export function AiNotConfigured({ compact = false }: { compact?: boolean }) {
  const canManage = useCan(Permission.AI_CONFIG_MANAGE);
  return (
    <EmptyState
      compact={compact}
      icon={<KeyRound />}
      title="AI isn’t set up for this organization"
      description={
        canManage
          ? 'Add an AI provider and API key to start using the assistant and agents.'
          : 'Ask an administrator to add an AI provider in Settings → AI.'
      }
      action={
        canManage ? (
          <Button asChild>
            <Link href="/settings/ai">Open Settings → AI</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
