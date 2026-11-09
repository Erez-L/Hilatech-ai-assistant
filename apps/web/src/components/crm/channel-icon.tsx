import type { LucideProps } from 'lucide-react';
import { Globe, Mail, MessageCircle, MessagesSquare, Phone, Webhook } from 'lucide-react';
import type { ConversationChannel } from '@hilatech/contracts';

const ICONS = {
  web: Globe,
  email: Mail,
  whatsapp: MessageCircle,
  phone: Phone,
  internal: MessagesSquare,
  api: Webhook,
} as const;

export function ChannelIcon({ channel, ...props }: { channel: ConversationChannel } & LucideProps) {
  const Icon = ICONS[channel] ?? MessagesSquare;
  return <Icon {...props} />;
}
