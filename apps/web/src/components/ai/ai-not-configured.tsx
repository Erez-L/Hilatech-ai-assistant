'use client';

import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { Button, EmptyState } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';
import { useT } from '@/i18n/provider';

/** Shown when the organization has no usable AI provider (409 AI_NOT_CONFIGURED or no providers). */
export function AiNotConfigured({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const canManage = useCan(Permission.AI_CONFIG_MANAGE);
  return (
    <EmptyState
      compact={compact}
      icon={<KeyRound />}
      title={t('ai.aiIsnTSetUp')}
      description={canManage ? t('ai.addAnAiProviderAnd') : t('ai.askAnAdministratorToAdd')}
      action={
        canManage ? (
          <Button asChild>
            <Link href="/settings/ai">{t('ai.openSettingsAi')}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}
