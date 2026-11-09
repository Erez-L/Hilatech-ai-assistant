'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@hilatech/ui';
import { InboundEndpoints } from '@/components/automation/inbound-endpoints';
import { OutboundWebhooks } from '@/components/automation/outbound-webhooks';

export function WebhooksView() {
  return (
    <Tabs defaultValue="outbound">
      <TabsList aria-label="Webhook types">
        <TabsTrigger value="outbound">Outbound</TabsTrigger>
        <TabsTrigger value="inbound">Inbound</TabsTrigger>
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
