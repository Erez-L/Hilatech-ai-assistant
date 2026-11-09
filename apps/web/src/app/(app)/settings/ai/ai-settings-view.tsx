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

export function AiSettingsView() {
  const canSeeTools = useCan(Permission.AGENTS_READ);
  return (
    <PermissionGate anyOf={[Permission.AI_CONFIG_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Settings"
          description="Connect an AI provider, watch usage and manage the building blocks of your agents."
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
