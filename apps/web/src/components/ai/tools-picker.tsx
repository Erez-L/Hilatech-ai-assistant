'use client';

import * as React from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ToolDefinition } from '@hilatech/contracts';
import { Checkbox } from '@hilatech/ui';
import { RiskBadge } from './badges';
import { enumLabel } from '@/i18n/enums';
import { useT } from '@/i18n/provider';

export interface ToolsPickerProps {
  tools: readonly ToolDefinition[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** When false, write tools get a hint that the agent also needs “Allow write actions”. */
  allowWrite?: boolean;
}

/** Tool catalogue grouped by category with risk badges. Dangerous tools carry a standing warning. */
export function ToolsPicker({
  tools,
  value,
  onChange,
  disabled,
  allowWrite = true,
}: ToolsPickerProps) {
  const t = useT();
  const groups = React.useMemo(() => {
    const map = new Map<string, ToolDefinition[]>();
    for (const t of tools) map.set(t.category, [...(map.get(t.category) ?? []), t]);
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [tools]);
  const selected = new Set(value);
  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    onChange(Array.from(next));
  };

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([category, items]) => (
        <fieldset key={category} className="flex flex-col gap-1.5" disabled={disabled}>
          <legend className="mb-1 text-xs font-semibold tracking-wide rtl:tracking-normal text-fg-muted uppercase">
            {enumLabel(t, 'toolCategory', category)}
          </legend>
          {items.map((tool) => {
            const id = `tool-${tool.key}`;
            return (
              <div
                key={tool.key}
                className="flex items-start gap-3 rounded-md border border-border px-3 py-2"
              >
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  checked={selected.has(tool.key)}
                  onCheckedChange={(c) => toggle(tool.key, c === true)}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <label
                    htmlFor={id}
                    className="flex flex-wrap items-center gap-2 text-sm font-medium"
                  >
                    {tool.name}
                    <span className="font-mono text-xs font-normal text-fg-subtle">{tool.key}</span>
                    <RiskBadge risk={tool.riskLevel} />
                  </label>
                  <p className="text-xs text-fg-muted">{tool.description}</p>
                  {tool.riskLevel === 'dangerous' ? (
                    <p className="flex items-center gap-1 text-xs text-danger">
                      <TriangleAlert className="size-3.5" aria-hidden />
                      {t('ai.dangerousNeverRunsWithoutAuthorization')}
                    </p>
                  ) : null}
                  {tool.riskLevel === 'write' && !allowWrite && selected.has(tool.key) ? (
                    <p className="text-xs text-warning">{t('ai.needsAllowWriteActionsBelow')}</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}
