'use client';

import { Permission } from '@hilatech/contracts';
import { PageHeader } from '@hilatech/ui';
import { PermissionGate } from '@/components/common/permission-gate';
import { SettingsTabs } from '@/components/settings/settings-tabs';
import { useCan } from '@/hooks/use-can';
import { PromptsCard } from './prompts-card';
import { ProvidersCard } from './providers-card';
import { ToolsCard } from './tools-card';
import { UsageCard } from './usage-card';
import { useT } from '@/i18n/provider';

export function AiSettingsView() {
  const t = useT();
  const canSeeTools = useCan(Permission.AGENTS_READ);
  return (
    <PermissionGate anyOf={[Permission.AI_CONFIG_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={t('settings.settings')}
          description={t('settings.connectAnAiProviderWatch')}
        >
          <SettingsTabs />
        </PageHeader>
        <ProvidersCard />
        <UsageCard />
        <PromptsCard />
        {canSeeTools ? <ToolsCard /> : null}
      </div>
    </PermissionGate>
  );
}
