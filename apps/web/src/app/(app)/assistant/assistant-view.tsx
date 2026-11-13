'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Plus, Sparkles } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { Button, EmptyState, PageHeader, cn, toast } from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import { useAiProviders, useCreateAssistantThread } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { PermissionGate } from '@/components/common/permission-gate';
import { AiNotConfigured } from '@/components/ai/ai-not-configured';
import { ChatPane } from './chat-pane';
import { ThreadList } from './thread-list';
import { useT } from '@/i18n/provider';

/**
 * Two-pane assistant. The open thread is `?t=<id>`; CRM context arrives as `?leadId=`, `?contactId=`
 * or `?conversationId=` and is passed with every message sent from this page.
 */
export function AssistantView() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canConfigure = useCan(Permission.AI_CONFIG_READ);
  const threadId = searchParams.get('t');
  const context = React.useMemo(() => {
    const ctx: { leadId?: string; contactId?: string; conversationId?: string } = {};
    const leadId = searchParams.get('leadId');
    const contactId = searchParams.get('contactId');
    const conversationId = searchParams.get('conversationId');
    if (leadId) ctx.leadId = leadId;
    if (contactId) ctx.contactId = contactId;
    if (conversationId) ctx.conversationId = conversationId;
    return ctx;
  }, [searchParams]);

  // The provider list needs ai:config:read; without it the 409 from the first message is the signal.
  const providers = useAiProviders({ enabled: canConfigure });
  const notConfigured =
    canConfigure &&
    providers.isSuccess &&
    // Amazon Bedrock authenticates with the server's AWS identity, so it never has an API key.
    !providers.data.some(
      (p) => p.isEnabled && (p.hasApiKey || p.provider === 'mock' || p.provider === 'bedrock'),
    );

  const create = useCreateAssistantThread();

  const select = React.useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) params.set('t', id);
      else params.delete('t');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const newThread = () =>
    create.mutate(
      {},
      { onSuccess: (t) => select(t.id), onError: (e) => toast.error(getErrorMessage(e)) },
    );

  return (
    <PermissionGate anyOf={[Permission.AI_ASSISTANT_USE]}>
      <div className="flex flex-col gap-4">
        <PageHeader
          title={t('common.assistant')}
          description={t('assistant.askQuestionsAboutYourPipeline')}
          actions={
            <Button
              leadingIcon={<Plus aria-hidden />}
              onClick={newThread}
              loading={create.isPending}
              disabled={notConfigured}
            >
              {t('assistant.newThread')}
            </Button>
          }
        />
        {notConfigured ? (
          <AiNotConfigured />
        ) : (
          <div className="grid h-[calc(100dvh-13.5rem)] min-h-[32rem] overflow-hidden rounded-lg border border-border bg-surface shadow-xs lg:grid-cols-[20rem_minmax(0,1fr)]">
            <aside
              aria-label={t('assistant.threads')}
              className={cn(
                'flex min-h-0 flex-col border-border lg:border-e',
                threadId ? 'hidden lg:flex' : 'flex',
              )}
            >
              <ThreadList selectedId={threadId} onSelect={select} onNew={newThread} />
            </aside>
            <div className={cn('min-h-0 min-w-0 flex-col', threadId ? 'flex' : 'hidden lg:flex')}>
              {threadId ? (
                <ChatPane
                  key={threadId}
                  threadId={threadId}
                  context={context}
                  onBack={() => select(null)}
                  onDeleted={() => select(null)}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center p-8">
                  <EmptyState
                    compact
                    icon={<Sparkles />}
                    title={t('assistant.startAConversation')}
                    description={t('assistant.pickAThreadOnThe')}
                    action={
                      <Button size="sm" leadingIcon={<Plus aria-hidden />} onClick={newThread}>
                        {t('assistant.newThread')}
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PermissionGate>
  );
}
