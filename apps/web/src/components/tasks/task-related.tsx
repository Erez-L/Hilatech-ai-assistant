'use client';

import Link from 'next/link';
import { Contact, Handshake, MessageSquare, Target } from 'lucide-react';
import type { TaskWithRelations } from '@hilatech/contracts';
import { contactName } from '@/lib/crm';
import { useT } from '@/i18n/provider';

const linkClass =
  'inline-flex max-w-48 items-center gap-1 truncate rounded-sm text-xs text-fg-muted hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Links to the lead / contact / deal / conversation the task belongs to. */
export function TaskRelated({ task }: { task: TaskWithRelations }) {
  const t = useT();
  const items = [
    task.lead && {
      key: 'lead',
      href: `/leads/${task.lead.id}`,
      icon: <Target className="size-3 shrink-0" aria-hidden />,
      label: task.lead.title,
      kind: t('common.lead'),
    },
    task.contact && {
      key: 'contact',
      href: `/contacts/${task.contact.id}`,
      icon: <Contact className="size-3 shrink-0" aria-hidden />,
      label: contactName(task.contact),
      kind: t('common.contact'),
    },
    task.deal && {
      key: 'deal',
      href: `/deals/${task.deal.id}`,
      icon: <Handshake className="size-3 shrink-0" aria-hidden />,
      label: task.deal.title,
      kind: t('deals.deal'),
    },
    task.conversation && {
      key: 'conversation',
      href: `/conversations/${task.conversation.id}`,
      icon: <MessageSquare className="size-3 shrink-0" aria-hidden />,
      label: task.conversation.subject || t('common.noSubject'),
      kind: t('tasks.conversation'),
    },
  ].filter(Boolean) as {
    key: string;
    href: string;
    icon: React.ReactNode;
    label: string;
    kind: string;
  }[];
  if (items.length === 0) return <span className="text-fg-subtle">—</span>;
  return (
    <ul className="flex flex-col gap-1">
      {items.map((i) => (
        <li key={i.key} className="min-w-0">
          <Link href={i.href} className={linkClass} title={`${i.kind}: ${i.label}`}>
            {i.icon}
            <span className="truncate" dir="auto">
              {i.label}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
