'use client';

import * as React from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import type { ToolDefinition } from '@hilatech/contracts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  JsonViewer,
  Skeleton,
  cn,
} from '@hilatech/ui';
import { useAiTools } from '@/hooks/queries';
import { QueryState } from '@/components/common/query-state';
import { RiskBadge } from '@/components/ai/badges';
import { enumLabel } from '@/i18n/enums';
import { useT } from '@/i18n/provider';

export function ToolsCard() {
  const t = useT();
  const tools = useAiTools();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.toolCatalogue')}</CardTitle>
        <CardDescription>{t('settings.whatTheAssistantAndAgents')}</CardDescription>
      </CardHeader>
      <CardContent>
        <QueryState
          query={tools}
          compact
          errorTitle={t('settings.theToolCatalogueCouldnT')}
          loading={<Skeleton className="h-40 w-full" />}
          isEmpty={(d) => d.length === 0}
          empty={<EmptyState compact icon={<Wrench />} title={t('settings.noToolsAvailable')} />}
        >
          {(list) => <ToolList tools={list} />}
        </QueryState>
      </CardContent>
    </Card>
  );
}

function ToolList({ tools }: { tools: ToolDefinition[] }) {
  const t = useT();
  const groups = React.useMemo(() => {
    const map = new Map<string, ToolDefinition[]>();
    for (const tool of tools) map.set(tool.category, [...(map.get(tool.category) ?? []), tool]);
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);
  return (
    <div className="flex flex-col gap-5">
      {groups.map(([category, items]) => (
        <section
          key={category}
          aria-label={enumLabel(t, 'toolCategory', category)}
          className="flex flex-col gap-2"
        >
          <h3 className="text-xs font-semibold tracking-wide rtl:tracking-normal text-fg-muted uppercase">
            {enumLabel(t, 'toolCategory', category)}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {items.map((t) => (
              <ToolRow key={t.key} tool={t} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolDefinition }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {tool.name}
            <span className="font-mono text-xs font-normal text-fg-subtle">{tool.key}</span>
            <RiskBadge risk={tool.riskLevel} />
          </span>
          <span className="text-xs text-fg-muted">{tool.description}</span>
          <span className="text-2xs text-fg-subtle">
            {t('settings.requires')}{' '}
            {tool.requiredPermission ? (
              <code className="font-mono">{tool.requiredPermission}</code>
            ) : (
              t('settings.noPermission')
            )}
          </span>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-label={t(open ? 'settings.hideInputSchema' : 'settings.showInputSchema', {
            name: tool.name,
          })}
          onClick={() => setOpen((v) => !v)}
          className="flex shrink-0 items-center gap-1 rounded-xs text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('settings.schema')}
          <ChevronRight
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            aria-hidden
          />
        </button>
      </div>
      {open ? (
        <div className="mt-2">
          <JsonViewer value={tool.inputSchema} maxHeight={240} />
        </div>
      ) : null}
    </li>
  );
}
