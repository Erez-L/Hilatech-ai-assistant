'use client';

import type { AgentExecutionStatus, AiHealthStatus, ToolRiskLevel } from '@hilatech/contracts';
import { Badge, StatusBadge, type StatusBadgeProps } from '@hilatech/ui';
import { EXECUTION_STATUS_LABELS, EXECUTION_STATUS_TONES, RISK_LABELS } from '@/lib/ai';
import { useT } from '@/i18n/provider';

export function ExecutionStatusBadge({
  status,
  ...props
}: { status: AgentExecutionStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  const t = useT();
  return (
    <StatusBadge
      status={status}
      tone={EXECUTION_STATUS_TONES[status]}
      label={t(EXECUTION_STATUS_LABELS[status])}
      {...props}
    />
  );
}

const RISK_VARIANT = { read: 'neutral', write: 'warning', dangerous: 'danger' } as const;

export function RiskBadge({ risk }: { risk: ToolRiskLevel }) {
  const t = useT();
  return (
    <Badge variant={RISK_VARIANT[risk]} className="px-1.5 py-0 text-[0.625rem] leading-4">
      {t(RISK_LABELS[risk])}
    </Badge>
  );
}

export function HealthBadge({ status }: { status: AiHealthStatus }) {
  const t = useT();
  const map = {
    ok: { tone: 'success', label: t('ai.healthy') },
    error: { tone: 'danger', label: t('ai.failing') },
    unknown: { tone: 'neutral', label: t('ai.notChecked') },
  } as const;
  return <StatusBadge status={status} tone={map[status].tone} label={map[status].label} />;
}
