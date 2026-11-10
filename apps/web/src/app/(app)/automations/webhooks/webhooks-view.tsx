'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hilatech/ui';
import { InboundEndpoints } from '@/components/automation/inbound-endpoints';
import { OutboundWebhooks } from '@/components/automation/outbound-webhooks';
import { useT } from '@/i18n/provider';

export function WebhooksView() {
  const t = useT();
  return (
    <Tabs defaultValue="outbound">
      <TabsList aria-label={t('automations.webhookTypes')}>
        <TabsTrigger value="outbound">{t('automations.outbound')}</TabsTrigger>
        <TabsTrigger value="inbound">{t('automations.inbound')}</TabsTrigger>
      </TabsList>
      <TabsContent value="outbound">
        <OutboundWebhooks />
      </TabsContent>
      <TabsContent value="inbound">
        <InboundEndpoints />
      </TabsContent>
    </Tabs>
  );
}
