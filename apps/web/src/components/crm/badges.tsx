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

export function LeadStatusBadge({
  status,
  ...props
}: { status: LeadStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  return (
    <StatusBadge
      status={status}
      tone={LEAD_STATUS_TONES[status]}
      label={LEAD_STATUS_LABELS[status]}
      {...props}
    />
  );
}

export function ConversationStatusBadge({
  status,
  ...props
}: { status: ConversationStatus } & Omit<StatusBadgeProps, 'status' | 'tone' | 'label'>) {
  return (
    <StatusBadge
      status={status}
      tone={CONVERSATION_STATUS_TONES[status]}
      label={CONVERSATION_STATUS_LABELS[status]}
      {...props}
    />
  );
}

export function ChannelBadge({ channel }: { channel: ConversationChannel }) {
  return (
    <Badge variant="outline">
      <ChannelIcon channel={channel} aria-hidden />
      {CONVERSATION_CHANNEL_LABELS[channel]}
    </Badge>
  );
}
