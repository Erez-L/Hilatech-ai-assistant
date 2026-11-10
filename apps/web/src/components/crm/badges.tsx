import type { ConversationChannel, ConversationStatus, LeadStatus } from '@hilatech/contracts';
import { Badge, StatusBadge, type StatusBadgeProps } from '@hilatech/ui';
import {
  CONVERSATION_CHANNEL_LABELS,
  CONVERSATION_STATUS_LABELS,
  CONVERSATION_STATUS_TONES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
} from '@/lib/crm';
import { ChannelIcon } from './channel-icon';
import { useT } from '@/i18n/provider';

export function LeadStatusBadge({
  status,
  ...props
}: { status: LeadStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  const t = useT();
  return (
    <StatusBadge
      status={status}
      tone={LEAD_STATUS_TONES[status]}
      label={t(LEAD_STATUS_LABELS[status])}
      {...props}
    />
  );
}

export function ConversationStatusBadge({
  status,
  ...props
}: { status: ConversationStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  const t = useT();
  return (
    <StatusBadge
      status={status}
      tone={CONVERSATION_STATUS_TONES[status]}
      label={t(CONVERSATION_STATUS_LABELS[status])}
      {...props}
    />
  );
}

export function ChannelBadge({ channel }: { channel: ConversationChannel }) {
  const t = useT();
  return (
    <Badge variant="outline">
      <ChannelIcon channel={channel} aria-hidden />
      {t(CONVERSATION_CHANNEL_LABELS[channel])}
    </Badge>
  );
}
